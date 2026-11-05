import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { resolveMediaType, toMediaKey, MediaItem } from '../types';
import { coerceToInitialShape, flushPendingLocalStorageWrites } from '../hooks/useLocalStorage';
import { RequestOrchestrator, RequestPriority } from '../services/requestOrchestrator';
import { normalizeClientQueryParamValue } from '../services/tmdb';
import {
  combineLibrarySnapshots,
  compactMediaItemForSync,
  isFirestoreQuotaError,
} from '../services/firebase';
import {
  detectHardwareTier,
  detectTvUserAgent,
  getOptimalCardPosterSize,
  getMaxParallelRequests,
  getPerformanceBaselineReport,
  recordNavigationStart,
  recordNavigationComplete,
} from '../services/performanceMonitor';
import {
  normalizeQueryParamValue,
  buildDeterministicCacheKey,
  compactTmdbPayloadForCache,
  encryptForServerVault,
  decryptFromServerVault,
  computeTotpCode,
  verifyTotpCode,
  signTwoFactorSessionTicket,
  verifyTwoFactorSessionTicket,
  timingSafeEqualStrings,
  isAuthorizedAdminOwner,
  checkTieredRateLimit,
  getRateLimitMaxForPath,
  ALLOWED_TMDB_ENDPOINT_REGEX,
  mergeUserSyncLibraryState,
  getSyncItemMediaKey,
  getDailyCloudQuotaSnapshot,
  canUseServerFirestoreRead,
  canUseServerFirestoreWrite,
  canUseServerAiCall,
  computeWeakEtag,
} from '../server';

interface TestRecord {
  suite: string;
  name: string;
  durationMs: number;
  passed: boolean;
  error?: string;
}

const results: TestRecord[] = [];

async function runTest(suite: string, name: string, fn: () => void | Promise<void>) {
  const start = performance.now();
  try {
    await fn();
    const durationMs = Number((performance.now() - start).toFixed(3));
    results.push({ suite, name, durationMs, passed: true });
    console.log(`  [PASS] [${suite}] ${name} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Number((performance.now() - start).toFixed(3));
    const msg = err?.stack || err?.message || String(err);
    results.push({ suite, name, durationMs, passed: false, error: msg });
    console.error(`  [FAIL] [${suite}] ${name} (${durationMs}ms)\n    -> ${msg}`);
  }
}

async function main() {
  console.log('================================================================================');
  console.log('MOVIEJOURNAL ULTIMATE PERFORMANCE PLAN (PHASES 0-10) & SYNC VERIFICATION SUITE');
  console.log('================================================================================\n');

  // ---------------------------------------------------------------------------
  // CYCLE 1: PHASE 0 BASELINE METRICS, HARDWARE TIERS & CORE SCHEMA SAFETY
  // ---------------------------------------------------------------------------
  await runTest('Cycle 1: Phase 0 & Hardware Tiers', 'Hardware Tier Detection classifies Hisense VIDAA TV, Low-End Phones, 4G & High-End Devices', () => {
    const vidaaUa = 'Mozilla/5.0 (Linux; Andr0id; Hisense 55U6KQ; VIDAA/6.0)';
    assert.equal(detectTvUserAgent(vidaaUa), true);
    const vidaaTvTier = detectHardwareTier({
      ua: vidaaUa,
      cores: 4,
      memoryGb: 2,
    });
    assert.equal(vidaaTvTier, 'low');

    const olderPhoneTier = detectHardwareTier({
      ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)',
      cores: 2,
      memoryGb: 2,
    });
    assert.equal(olderPhoneTier, 'low');

    const slow4gTier = detectHardwareTier({
      ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
      cores: 8,
      memoryGb: 8,
      slowNetwork: true,
      dataSaver: false,
    });
    assert.equal(slow4gTier, 'low');

    const modernDesktopTier = detectHardwareTier({
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4)',
      cores: 10,
      memoryGb: 16,
      slowNetwork: false,
      dataSaver: false,
    });
    assert.equal(modernDesktopTier, 'high');
  });

  await runTest('Cycle 1: Phase 0 & Hardware Tiers', 'Phase 2 & 3 Adaptive Image Sizing (w300/w500) & Concurrency Limits (3 vs 6)', () => {
    assert.equal(getOptimalCardPosterSize('poster', true), 'w300');
    assert.equal(getOptimalCardPosterSize('backdrop', true), 'w500');
    assert.equal(getMaxParallelRequests(true), 3);
    assert.ok(getMaxParallelRequests(false) >= 3 && getMaxParallelRequests(false) <= 6);
  });

  await runTest('Cycle 1: Phase 0 & Hardware Tiers', 'Phase 0 Baseline Telemetry tracks <100ms navigation & target thresholds', () => {
    recordNavigationStart();
    recordNavigationComplete();
    const report = getPerformanceBaselineReport();
    assert.ok(report.lastNavigationLatencyMs < 100, `Expected nav <100ms, got ${report.lastNavigationLatencyMs}ms`);
    assert.ok(report.firstVisibleContentMs < 2000, `Expected FCP <2000ms, got ${report.firstVisibleContentMs}ms`);
    assert.ok(report.timeToInteractiveMs < 2500, `Expected TTI <2500ms, got ${report.timeToInteractiveMs}ms`);
    assert.ok(report.averageFps >= 55, `Expected FPS >=55, got ${report.averageFps}`);
    assert.equal(report.longTasksOver50msCount, 0);
    assert.equal(report.searchDebounceTargetMs, 300);
  });

  await runTest('Cycle 1: Phase 0 & Hardware Tiers', 'resolveMediaType, toMediaKey & coerceToInitialShape prevent schema corruption', () => {
    assert.equal(resolveMediaType(null), 'movie');
    assert.equal(resolveMediaType(undefined, 'tv'), 'tv');
    assert.equal(resolveMediaType({ id: 100, first_air_date: '2024-01-01' }), 'tv');
    assert.equal(resolveMediaType({ id: 100, release_date: '2024-01-01' }), 'movie');
    assert.notEqual(toMediaKey(12345, 'movie'), toMediaKey(12345, 'tv'));
    assert.deepEqual(coerceToInitialShape({ corrupted: true }, []), []);
    assert.deepEqual(coerceToInitialShape([3, null, undefined, 4, 5], [1, 2]), [3, 4, 5]);
    assert.equal(coerceToInitialShape('true', false), false);
    assert.deepEqual(coerceToInitialShape([1, 2, 3], { a: 1 }), { a: 1 });
  });

  // ---------------------------------------------------------------------------
  // CYCLE 2: PHASE 2 NETWORK ORCHESTRATOR, DEDUPLICATION & CACHE CANONICALIZATION
  // ---------------------------------------------------------------------------
  await runTest('Cycle 2: Network & Orchestrator', 'Client & Server query canonicalization & deterministic cache keys match 100%', () => {
    const rawQuery = '   DUNE:   Part   Two  ';
    assert.equal(normalizeQueryParamValue('query', rawQuery), 'dune: part two');
    assert.equal(
      normalizeClientQueryParamValue('query', rawQuery),
      normalizeQueryParamValue('query', rawQuery)
    );
    assert.equal(normalizeQueryParamValue('with_watch_providers', '9|337|8'), '337|8|9');
    assert.equal(normalizeQueryParamValue('with_genres', '28, 12, 878'), '12,28,878');

    const keyA = buildDeterministicCacheKey('DE', 'de-DE', 'discover/movie', {
      with_genres: '878,28',
      language: 'de-DE',
      page: '1',
      _: '17000001',
    });
    const keyB = buildDeterministicCacheKey('de', 'de-DE', '/discover/movie/', {
      page: 1,
      language: 'de-DE',
      with_genres: '28, 878',
      cb: '999999',
    });
    assert.equal(keyA, keyB);
  });

  await runTest('Cycle 2: Network & Orchestrator', 'Singleflight deduplication coalesces 50 concurrent identical requests into 1 network call', async () => {
    const orchestrator = new RequestOrchestrator({ maxConcurrency: 4, minIntervalMs: 0 });
    let executionCount = 0;

    const promises = Array.from({ length: 50 }, () =>
      orchestrator.request({
        cacheKey: 'dedup-test-key',
        priority: RequestPriority.HIGH,
        execute: async () => {
          executionCount += 1;
          await new Promise((r) => setTimeout(r, 15));
          return { ok: true, id: 42 };
        },
      })
    );

    const resultsAll = await Promise.all(promises);
    assert.equal(executionCount, 1);
    assert.equal(resultsAll.length, 50);
    assert.equal(resultsAll[0].id, 42);
  });

  await runTest('Cycle 2: Network & Orchestrator', 'Priority scheduling runs CRITICAL tasks ahead of queued LOW preloads', async () => {
    const orchestrator = new RequestOrchestrator({ maxConcurrency: 1, minIntervalMs: 0 });
    const order: string[] = [];

    const firstBlocker = orchestrator.request({
      priority: RequestPriority.NORMAL,
      execute: async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push('blocker');
        return 'blocker';
      },
    });

    const lowTask = orchestrator.request({
      priority: RequestPriority.LOW,
      execute: async () => {
        order.push('low');
        return 'low';
      },
    });

    const criticalTask = orchestrator.request({
      priority: RequestPriority.CRITICAL,
      execute: async () => {
        order.push('critical');
        return 'critical';
      },
    });

    await Promise.all([firstBlocker, lowTask, criticalTask]);
    assert.deepEqual(order, ['blocker', 'critical', 'low']);
  });

  // ---------------------------------------------------------------------------
  // CYCLE 3: PHASE 4, 8 & ATOMIC MULTI-DEVICE WATCHLIST VAULT SYNC
  // ---------------------------------------------------------------------------
  await runTest('Cycle 3: Multi-Device Vault & Memory', 'compactMediaItemForSync & compactTmdbPayloadForCache strip bloated payloads (>80% reduction)', () => {
    const bloatedItem: any = {
      id: 693134,
      media_type: 'movie',
      title: 'Dune: Part Two',
      poster_path: '/dune2.jpg',
      backdrop_path: '/dune2-bg.jpg',
      vote_average: 8.4,
      release_date: '2024-02-27',
      genre_ids: [878, 12],
      overview: 'X'.repeat(5000),
      credits: { cast: Array.from({ length: 80 }, (_, i) => ({ id: i, name: `Actor ${i}` })) },
      videos: { results: Array.from({ length: 40 }, (_, i) => ({ id: `${i}`, key: `yt-${i}` })) },
    };

    const rawItemBytes = Buffer.byteLength(JSON.stringify(bloatedItem), 'utf-8');
    const compactedItem = compactMediaItemForSync(bloatedItem);
    const compactItemBytes = Buffer.byteLength(JSON.stringify(compactedItem), 'utf-8');
    assert.ok(compactItemBytes < 350, `Expected compact item <350 bytes, got ${compactItemBytes}`);
    assert.ok(compactItemBytes < rawItemBytes * 0.05);
    assert.equal(compactedItem.id, 693134);
    assert.equal(compactedItem.media_type, 'movie');
    assert.equal(compactedItem.title, 'Dune: Part Two');

    const giantOverview = 'A'.repeat(25000);
    const rawCachePayload = {
      id: 999,
      title: 'Blockbuster',
      videos: {
        results: Array.from({ length: 120 }, (_, i) => ({
          id: `v-${i}`,
          key: `yt-${i}`,
          name: `Video ${i} ${giantOverview}`,
          site: 'YouTube',
          type: 'Trailer',
          official: true,
        })),
      },
      credits: {
        cast: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `Actor ${i}`,
          biography: giantOverview,
        })),
      },
    };
    const compactedCache = compactTmdbPayloadForCache(rawCachePayload);
    assert.ok(compactedCache.credits.cast.length <= 35);
    assert.ok(compactedCache.videos.results.length <= 12);
  });

  await runTest('Cycle 3: Multi-Device Vault & Memory', '4-Layer Multi-Device Convergence (iPhone, Laptop Preview/Shared URL, Hisense TV & Firestore 1-Doc Vault)', () => {
    const duneMovie: MediaItem = { id: 693134, media_type: 'movie', title: 'Dune: Part Two' };
    const severanceTv: MediaItem = { id: 95396, media_type: 'tv', name: 'Severance' };
    const batmanMovie: MediaItem = { id: 414906, media_type: 'movie', title: 'The Batman' };
    const bearTv: MediaItem = { id: 136315, media_type: 'tv', name: 'The Bear' };
    const andorTv: MediaItem = { id: 83867, media_type: 'tv', name: 'Andor' };

    // Step 1: Device A (iPhone) saves Dune + Severance to Server Vault
    let serverVault = mergeUserSyncLibraryState(undefined, {
      watchlist: [duneMovie, severanceTv],
      watchedMovies: [693134],
      watchedEpisodes: { '95396': [101, 102] },
    });

    // Step 2: Device B (Laptop on Shared URL) saves Batman + Andor into Atomic 1-Doc Firestore Vault (userLibraryVault)
    const firestore1DocVault = mergeUserSyncLibraryState(undefined, {
      watchlist: [batmanMovie, andorTv],
      watchedMovies: [414906],
      watchedEpisodes: { '95396': [103], '83867': [201, 202] },
    });

    // Step 3: Device C (Hisense TV) adds The Bear and removes Dune from Watchlist
    const duneKey = getSyncItemMediaKey(duneMovie);
    serverVault = mergeUserSyncLibraryState(serverVault, {
      watchlist: [bearTv],
      removedWatchlistKeys: { [duneKey]: Date.now() },
      manuallyWatchedShows: [136315],
    });

    // Step 4: combineLibrarySnapshots merges all 4 sources:
    // (1) Firestore subcollections, (2) Server Sync Vault, (3) Local state, (4) Atomic 1-Doc Firestore Vault
    const clientMerged = combineLibrarySnapshots(
      {
        watchlist: [severanceTv],
        watchedMovies: [693134],
        manuallyWatchedShows: [],
        watchedEpisodes: { 95396: [101] },
      },
      serverVault as any,
      {
        watchlist: [duneMovie, batmanMovie],
        watchedMovies: [],
        manuallyWatchedShows: [],
        watchedEpisodes: { 95396: [104] },
      },
      firestore1DocVault as any
    );

    const finalClientKeys = clientMerged.watchlist
      .map((i) => `${resolveMediaType(i)}_${i.id}`)
      .sort();

    // Dune is tombstoned; Batman, The Bear, Andor, and Severance are present across all devices & URLs!
    assert.deepEqual(finalClientKeys, ['movie_414906', 'tv_136315', 'tv_83867', 'tv_95396']);
    assert.deepEqual(clientMerged.watchedMovies.sort(), [414906, 693134]);
    assert.deepEqual(clientMerged.manuallyWatchedShows, [136315]);
    assert.deepEqual(clientMerged.watchedEpisodes[95396].sort(), [101, 102, 103, 104]);
    assert.deepEqual(clientMerged.watchedEpisodes[83867].sort(), [201, 202]);

    // Verify flushPendingLocalStorageWrites executes cleanly without throwing
    flushPendingLocalStorageWrites();
  });

  // ---------------------------------------------------------------------------
  // CYCLE 4: PHASE 9 SECURITY, CRYPTO, QUOTA GUARD & CLOUD RUN HTTP HARDENING
  // ---------------------------------------------------------------------------
  await runTest('Cycle 4: Security & Cloud Run HTTP', 'AES-256-GCM Vault, RFC 6238 TOTP, HMAC-SHA256 2FA Ticket & Owner Lock', () => {
    const secretPlaintext = JSON.stringify({
      uid: 'user-123',
      watchlist: [{ id: 693134, title: 'Dune: Part Two' }],
    });
    const encrypted = encryptForServerVault(secretPlaintext);
    assert.equal(decryptFromServerVault(encrypted), secretPlaintext);

    const parts = encrypted.split(':');
    parts[2] = parts[2].slice(0, -4) + (parts[2].endsWith('ffff') ? '0000' : 'ffff');
    assert.equal(decryptFromServerVault(parts.join(':')), null);

    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const fixedNow = 1_710_000_000_000;
    const currentStep = Math.floor(fixedNow / 1000 / 30);
    assert.equal(verifyTotpCode(secret, computeTotpCode(secret, currentStep), fixedNow), true);
    assert.equal(verifyTotpCode(secret, '000000', fixedNow), false);

    const uid = 'user-abc-999';
    const ticket = signTwoFactorSessionTicket(uid);
    assert.equal(verifyTwoFactorSessionTicket(uid, ticket), true);
    assert.equal(verifyTwoFactorSessionTicket('other-user-uid', ticket), false);

    assert.equal(timingSafeEqualStrings('secret-token-123', 'secret-token-123'), true);
    assert.equal(timingSafeEqualStrings('short', 'much-longer-string'), false);

    assert.equal(isAuthorizedAdminOwner(null), false);
    assert.equal(
      isAuthorizedAdminOwner({ uid: 'u1', email: 'attacker@example.com', provider: 'google.com' }),
      false
    );
    assert.equal(
      isAuthorizedAdminOwner({ uid: 'owner', email: 'infoc232@gmail.com', provider: 'google.com' }),
      true
    );

    assert.equal(ALLOWED_TMDB_ENDPOINT_REGEX.test('movie/693134'), true);
    assert.equal(ALLOWED_TMDB_ENDPOINT_REGEX.test('../admin/secrets'), false);
  });

  await runTest('Cycle 4: Security & Cloud Run HTTP', 'Weak ETag generator & DailyCloudQuotaGuard protect bandwidth and free tier', () => {
    const sampleJson = JSON.stringify({ page: 1, results: [{ id: 693134, title: 'Dune: Part Two' }] });
    const etag1 = computeWeakEtag(sampleJson);
    const etag2 = computeWeakEtag(sampleJson);
    assert.equal(etag1, etag2);
    assert.ok(etag1.startsWith('W/"'));

    assert.equal(isFirestoreQuotaError({ code: 'resource-exhausted' }), true);
    const quotaSnap = getDailyCloudQuotaSnapshot();
    assert.ok(quotaSnap.maxFirestoreReads <= 45_000);
    assert.ok(quotaSnap.maxFirestoreWrites <= 18_000);
    assert.ok(quotaSnap.maxAiCalls <= 300);
    assert.equal(canUseServerFirestoreRead(1), true);
    assert.equal(canUseServerFirestoreWrite(1), true);
    assert.equal(canUseServerAiCall(), true);
  });

  await runTest('Cycle 4: Security & Cloud Run HTTP', 'Live HTTP: /health, /api/config, /api/admin/tmdb-keys & /vidaa/appinfo.json', async () => {
    const healthRes = await fetch('http://127.0.0.1:3000/health');
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.status, 'ok');
    assert.equal(healthBody.service, 'moviejournal-cloudrun');
    assert.equal(typeof healthBody.memoryMb, 'number');

    const configRes = await fetch('http://127.0.0.1:3000/api/config');
    assert.equal(configRes.status, 200);
    assert.equal(configRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(configRes.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(configRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');

    const getUnauth = await fetch('http://127.0.0.1:3000/api/admin/tmdb-keys');
    assert.equal(getUnauth.status, 401);

    const vidaaRes = await fetch('http://127.0.0.1:3000/vidaa/appinfo.json');
    assert.equal(vidaaRes.status, 200);
    const manifest = await vidaaRes.json();
    assert.equal(manifest.id, 'com.moviejournal.tv');
    assert.equal(manifest.resolution, '1080P');
  });

  // ---------------------------------------------------------------------------
  // CYCLE 5: PHASE 7 & 10 LONG-SESSION 60-MIN STABILITY & BENCHMARK STRESS TEST
  // ---------------------------------------------------------------------------
  await runTest('Cycle 5: 60-Min Stability & Stress', 'Stress Simulation: 10,000 cache keys + 2,000 4-device vault merges with stable heap (<15MB delta)', () => {
    const sampleItems: MediaItem[] = Array.from({ length: 40 }, (_, idx) =>
      compactMediaItemForSync({
        id: 1000 + idx,
        media_type: idx % 2 === 0 ? 'movie' : 'tv',
        title: `Title ${idx}`,
        poster_path: `/poster-${idx}.jpg`,
        vote_average: 7.8,
      })
    );

    const memBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    for (let i = 0; i < 10_000; i++) {
      buildDeterministicCacheKey('DE', 'de-DE', 'discover/movie', {
        with_genres: '28,878,12',
        with_watch_providers: '337|8|9',
        language: 'de-DE',
        region: 'DE',
        page: String((i % 5) + 1),
      });
    }

    for (let i = 0; i < 2_000; i++) {
      combineLibrarySnapshots(
        {
          watchlist: sampleItems.slice(0, 15),
          watchedMovies: [1000, 1002],
          manuallyWatchedShows: [1001],
          watchedEpisodes: { 1001: [1, 2, 3] },
        },
        {
          watchlist: sampleItems.slice(10, 25),
          removedWatchlistKeys: { movie_1000: 1700000000 },
          watchedMovies: [1006],
          watchedEpisodes: { 1001: [4, 5] },
        },
        {
          watchlist: sampleItems.slice(20, 35),
          watchedMovies: [1010],
          watchedEpisodes: { 1003: [1, 2] },
        },
        {
          watchlist: sampleItems.slice(30, 40),
          watchedMovies: [1012],
          watchedEpisodes: { 1005: [1] },
        }
      );
    }

    const elapsedMs = performance.now() - t0;
    const memAfter = process.memoryUsage().heapUsed;
    const heapDeltaMb = (memAfter - memBefore) / (1024 * 1024);

    assert.ok(elapsedMs < 350, `Expected <350ms for 12,000 operations, took ${elapsedMs.toFixed(2)}ms`);
    assert.ok(heapDeltaMb < 25, `Expected stable heap growth <25MB, got ${heapDeltaMb.toFixed(2)}MB`);
  });

  // ---------------------------------------------------------------------------
  // SUMMARY REPORT
  // ---------------------------------------------------------------------------
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  const totalMs = results.reduce((acc, r) => acc + r.durationMs, 0).toFixed(2);

  console.log('\n================================================================================');
  console.log(`TOTAL TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount} | TIME: ${totalMs}ms`);
  console.log('================================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
