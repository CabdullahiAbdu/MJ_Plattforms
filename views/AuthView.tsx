import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TmdbService } from '../services/tmdb';
import {
  ArrowRight,
  X,
  Shield,
  Eye,
  EyeOff,
  Lock,
  LogOut,
  Tv,
  RefreshCw,
} from '../components/Icons';
import { BrandLogo, LogoMorphPhase } from '../components/BrandLogo';
import { CinemaProjectorStage } from '../components/CinemaProjectorStage';
import {
  auth,
  getTwoFactorStatus,
  verifyTwoFactorChallenge,
  createTvPairingSession,
  pollTvPairingSession,
  applyApprovedTvSessionAndHydrate,
  TvPairingSessionResponse,
} from '../services/firebase';

interface AuthViewProps {
  tmdb: TmdbService;
  language: string;
  region: string;
  isModal?: boolean;
  isTvMode?: boolean;
  /** When true, plays the Camera -> 'M' -> 'ovieJournal' intro first and then glides upward into the login screen */
  startWithIntro?: boolean;
  /** When true, user is already authenticated with Firebase but needs to complete their 2FA challenge */
  forceTwoFactorChallenge?: boolean;
  currentUserName?: string | null;
  onIntroCompleted?: () => void;
  onCloseModal?: () => void;
  onSuccess: (message: string) => void;
  onSignOutDuringChallenge?: () => Promise<void>;
  loginWithGoogle: () => Promise<unknown>;
  loginWithApple: () => Promise<unknown>;
  loginWithEmail: (email: string, pass: string) => Promise<unknown>;
  registerUserWithEmail: (email: string, pass: string, name?: string) => Promise<unknown>;
  sendResetPasswordEmail: (email: string) => Promise<void>;
}

type AuthMode = 'login' | 'register' | 'reset';

export const AuthView: React.FC<AuthViewProps> = ({
  tmdb,
  language,
  isModal = false,
  isTvMode = false,
  startWithIntro = false,
  forceTwoFactorChallenge = false,
  currentUserName = null,
  onIntroCompleted,
  onCloseModal,
  onSuccess,
  onSignOutDuringChallenge,
  loginWithGoogle,
  loginWithApple,
  loginWithEmail,
  registerUserWithEmail,
  sendResetPasswordEmail,
}) => {
  const isDe = language.toLowerCase().startsWith('de');
  const [playIntroOnMount] = useState(startWithIntro && !forceTwoFactorChallenge);
  const onIntroCompletedRef = useRef(onIntroCompleted);
  onIntroCompletedRef.current = onIntroCompleted;
  const timersRef = useRef<number[]>([]);

  // Logo choreography: 'camera-spin' -> 'morph-to-m' -> 'writing' -> 'complete' (login controls appear)
  const [logoPhase, setLogoPhase] = useState<LogoMorphPhase>(
    playIntroOnMount ? 'camera-spin' : 'complete'
  );
  const [isLoginVisible, setIsLoginVisible] = useState(!playIntroOnMount);

  const [emailExpanded, setEmailExpanded] = useState(false);
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [busyProvider, setBusyProvider] = useState<
    'google' | 'apple' | 'email' | '2fa' | 'tv' | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Smart TV QR-Code & 6-Digit Pairing State
  const [isTvPairingStep, setIsTvPairingStep] = useState<boolean>(false);
  const [tvSession, setTvSession] = useState<TvPairingSessionResponse | null>(null);
  const [tvSessionLoading, setTvSessionLoading] = useState<boolean>(false);
  const [tvSecondsLeft, setTvSecondsLeft] = useState<number>(300);

  // Two-Factor Authentication (2FA) Challenge State
  const [isTwoFactorStep, setIsTwoFactorStep] = useState<boolean>(forceTwoFactorChallenge);
  const [twoFactorCode, setTwoFactorCode] = useState<string>('');
  const [useBackupCodeMode, setUseBackupCodeMode] = useState<boolean>(false);
  const [pendingSuccessMsg, setPendingSuccessMsg] = useState<string>(
    isDe ? 'Erfolgreich angemeldet' : 'Signed in successfully'
  );
  const twoFactorInputRef = useRef<HTMLInputElement>(null);

  const startNewTvPairingSession = useCallback(async () => {
    setErrorMessage(null);
    setTvSessionLoading(true);
    try {
      const session = await createTvPairingSession();
      setTvSession(session);
      setTvSecondsLeft(
        Math.max(10, Math.ceil((session.expiresAt - Date.now()) / 1000))
      );
    } catch (err: any) {
      setErrorMessage(
        err?.message ||
          (isDe
            ? 'TV-Code konnte nicht erstellt werden.'
            : 'Could not generate TV pairing code.')
      );
    } finally {
      setTvSessionLoading(false);
    }
  }, [isDe]);

  // Auto-open QR Pairing when running in Smart TV / VIDAA mode (unless in 2FA challenge)
  useEffect(() => {
    if (isTvMode && !forceTwoFactorChallenge && !isTwoFactorStep) {
      setIsTvPairingStep(true);
    }
  }, [isTvMode, forceTwoFactorChallenge, isTwoFactorStep]);

  useEffect(() => {
    if (isTvPairingStep && !tvSession && !tvSessionLoading) {
      startNewTvPairingSession();
    }
  }, [isTvPairingStep, tvSession, tvSessionLoading, startNewTvPairingSession]);

  // Poll TV Pairing session every 2 seconds while QR screen is open
  useEffect(() => {
    if (!isTvPairingStep || !tvSession) return;
    let active = true;

    const countdownInterval = window.setInterval(() => {
      const rem = Math.max(0, Math.ceil((tvSession.expiresAt - Date.now()) / 1000));
      setTvSecondsLeft(rem);
      if (rem <= 0 && active) {
        startNewTvPairingSession();
      }
    }, 1000);

    const pollInterval = window.setInterval(async () => {
      if (!active) return;
      const pollRes = await pollTvPairingSession(
        tvSession.sessionId,
        tvSession.pollSecret
      );
      if (!active) return;
      if (pollRes.status === 'expired') {
        startNewTvPairingSession();
        return;
      }
      if (pollRes.status === 'approved') {
        setBusyProvider('tv');
        const ok = await applyApprovedTvSessionAndHydrate(pollRes);
        if (ok && active) {
          onSuccess(
            isDe
              ? `Smart TV verbunden (${pollRes.displayName || pollRes.email || 'Konto'})`
              : `Smart TV linked (${pollRes.displayName || pollRes.email || 'Account'})`
          );
        }
      }
    }, 1800);

    return () => {
      active = false;
      window.clearInterval(countdownInterval);
      window.clearInterval(pollInterval);
    };
  }, [isTvPairingStep, tvSession, startNewTvPairingSession, onSuccess, isDe]);

  useEffect(() => {
    if (forceTwoFactorChallenge) {
      setIsTwoFactorStep(true);
      setLogoPhase('complete');
      setIsLoginVisible(true);
    }
  }, [forceTwoFactorChallenge]);

  useEffect(() => {
    if (isTwoFactorStep) {
      const t = window.setTimeout(() => twoFactorInputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [isTwoFactorStep, useBackupCodeMode]);

  const clearIntroTimers = () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  };

  useEffect(() => {
    if (!playIntroOnMount) {
      setLogoPhase('complete');
      setIsLoginVisible(true);
      return;
    }

    setLogoPhase('camera-spin');
    setIsLoginVisible(false);

    const t1 = window.setTimeout(() => setLogoPhase('morph-to-m'), 600);
    const t2 = window.setTimeout(() => setLogoPhase('writing'), 1120);
    const t3 = window.setTimeout(() => setLogoPhase('complete'), 2480);
    const t4 = window.setTimeout(() => {
      setIsLoginVisible(true);
      onIntroCompletedRef.current?.();
    }, 2620);

    timersRef.current = [t1, t2, t3, t4];

    return () => {
      clearIntroTimers();
    };
  }, [playIntroOnMount]);

  const handleSkipIntro = () => {
    clearIntroTimers();
    setLogoPhase('complete');
    setIsLoginVisible(true);
    onIntroCompleted?.();
  };

  const mapFirebaseError = (err: unknown): string => {
    const code = String(
      (err as { code?: string; message?: string })?.code ||
        (err as { message?: string })?.message ||
        ''
    );
    if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password')) {
      return isDe
        ? 'E-Mail oder Passwort ist nicht korrekt.'
        : 'Invalid email or password.';
    }
    if (code.includes('auth/user-not-found')) {
      return isDe
        ? 'Kein Konto mit dieser E-Mail gefunden.'
        : 'No account found with this email.';
    }
    if (code.includes('auth/email-already-in-use')) {
      return isDe
        ? 'Diese E-Mail-Adresse wird bereits verwendet.'
        : 'This email address is already in use.';
    }
    if (code.includes('auth/weak-password')) {
      return isDe
        ? 'Das Passwort muss mindestens 6 Zeichen lang sein.'
        : 'Password must be at least 6 characters.';
    }
    if (
      code.includes('auth/popup-closed-by-user') ||
      code.includes('auth/cancelled-popup-request')
    ) {
      return isDe ? 'Anmeldefenster wurde geschlossen.' : 'Sign-in window was closed.';
    }
    if (code.includes('auth/popup-blocked')) {
      return isDe
        ? 'Popup wurde vom Browser blockiert. Bitte erlaube Popups für diese Seite.'
        : 'Sign-in popup was blocked by your browser.';
    }
    if (code.includes('auth/operation-not-allowed')) {
      return isDe
        ? 'Dieser Anmeldedienst ist aktuell nicht aktiviert.'
        : 'This sign-in provider is currently unavailable.';
    }
    if (code.includes('auth/too-many-requests')) {
      return isDe
        ? 'Zu viele Anmeldeversuche. Bitte warte einen kurzen Moment.'
        : 'Too many attempts. Please wait a moment and try again.';
    }
    return isDe
      ? 'Anmeldung fehlgeschlagen. Bitte überprüfe deine Eingaben.'
      : 'Authentication failed. Please try again.';
  };

  /**
   * Checks whether the newly authenticated user has 2FA enabled on their profile.
   * If 2FA is enabled and this device has no valid 2FA session ticket, transitions to the 2FA screen.
   */
  const checkTwoFactorGateAfterLogin = async (successToast: string) => {
    try {
      const status = await getTwoFactorStatus(auth.currentUser);
      if (status.twoFactorEnabled && !status.sessionVerified) {
        setPendingSuccessMsg(successToast);
        setTwoFactorCode('');
        setIsTwoFactorStep(true);
        return;
      }
    } catch {
      // If offline or status check unreachable, proceed with authenticated Firebase session
    }
    onSuccess(successToast);
  };

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setErrorMessage(null);
    setInfoMessage(null);
    setBusyProvider(provider);
    try {
      if (provider === 'google') {
        const res = await loginWithGoogle();
        if (res) {
          await checkTwoFactorGateAfterLogin(
            isDe ? 'Mit Google angemeldet' : 'Signed in with Google'
          );
        }
      } else {
        const res = await loginWithApple();
        if (res) {
          await checkTwoFactorGateAfterLogin(
            isDe ? 'Mit Apple angemeldet' : 'Signed in with Apple'
          );
        }
      }
    } catch (err) {
      setErrorMessage(mapFirebaseError(err));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage(
        isDe ? 'Bitte gib deine E-Mail-Adresse ein.' : 'Please enter your email.'
      );
      return;
    }

    setBusyProvider('email');
    try {
      if (mode === 'reset') {
        await sendResetPasswordEmail(trimmedEmail);
        setInfoMessage(
          isDe
            ? 'Link zum Zurücksetzen wurde an deine E-Mail gesendet.'
            : 'Password reset link has been sent to your email.'
        );
        setMode('login');
      } else if (mode === 'register') {
        if (password.length < 6) {
          setErrorMessage(
            isDe
              ? 'Passwort muss mindestens 6 Zeichen haben.'
              : 'Password must be at least 6 characters.'
          );
          setBusyProvider(null);
          return;
        }
        await registerUserWithEmail(trimmedEmail, password, name.trim() || undefined);
        onSuccess(isDe ? 'Willkommen bei MovieJournal' : 'Welcome to MovieJournal');
      } else {
        await loginWithEmail(trimmedEmail, password);
        await checkTwoFactorGateAfterLogin(
          isDe ? 'Willkommen zurück' : 'Welcome back'
        );
      }
    } catch (err) {
      setErrorMessage(mapFirebaseError(err));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleVerifyTwoFactor = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleaned = twoFactorCode.trim();
    if (!cleaned) {
      setErrorMessage(
        isDe ? 'Bitte gib deinen Sicherheitscode ein.' : 'Please enter your security code.'
      );
      return;
    }

    setErrorMessage(null);
    setBusyProvider('2fa');
    try {
      await verifyTwoFactorChallenge(cleaned, auth.currentUser);
      setIsTwoFactorStep(false);
      onSuccess(pendingSuccessMsg);
    } catch (err: any) {
      setErrorMessage(
        isDe
          ? 'Ungültiger 2FA-Code. Bitte prüfe deine Authenticator-App oder verwende einen Backup-Code.'
          : err?.message || 'Invalid verification code.'
      );
    } finally {
      setBusyProvider(null);
    }
  };

  const handleCancelTwoFactorChallenge = async () => {
    setErrorMessage(null);
    setTwoFactorCode('');
    setIsTwoFactorStep(false);
    if (onSignOutDuringChallenge) {
      await onSignOutDuringChallenge();
    } else {
      await auth.signOut().catch(() => {});
    }
  };

  return (
    <div
      data-tv-scope="modal"
      className="fixed inset-0 z-[230] bg-zinc-950 text-white font-sans overflow-y-auto no-scrollbar flex flex-col items-center justify-center px-[var(--fluid-page-px)] py-6 select-none"
    >
      {/* Ambient Movie Backdrop */}
      <CinemaProjectorStage tmdb={tmdb} />

      {/* Top-Right Skip / Close Action */}
      <div
        style={{
          top: 'max(1.25rem, calc(env(safe-area-inset-top) + 0.75rem))',
          right: 'var(--fluid-page-px)',
        }}
        className="fixed z-30 flex items-center gap-3"
      >
        {!isLoginVisible ? (
          <button
            type="button"
            tabIndex={0}
            onClick={handleSkipIntro}
            className="focusable-rounded px-3.5 py-1.5 rounded-full text-[clamp(0.625rem,1.8vw,0.72rem)] font-bold uppercase tracking-[0.18em] text-white/65 hover:text-white bg-white/[0.07] hover:bg-white/[0.14] border border-white/10 backdrop-blur-md transition-all"
          >
            {isDe ? 'Überspringen' : 'Skip'}
          </button>
        ) : isModal && onCloseModal && currentUserName && !isTwoFactorStep ? (
          <button
            type="button"
            tabIndex={0}
            onClick={onCloseModal}
            className="focusable-rounded p-2.5 rounded-full text-white/65 hover:text-white bg-white/[0.07] hover:bg-white/[0.14] border border-white/10 backdrop-blur-md transition-all"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        ) : null}
      </div>

      {/* Central Stage — Decoupled Logo + Login / 2FA / Smart TV QR Controls */}
      <div
        style={{ width: isTvPairingStep ? 'min(92vw, 460px)' : 'min(90vw, 384px)' }}
        className="relative z-10 flex flex-col items-center justify-center my-auto"
      >
        {/* 1. Monochrome Camera -> 'M' -> 'ovieJournal' Logo */}
        <div
          style={{
            transform: isLoginVisible
              ? 'translate3d(0, 0, 0) scale(1)'
              : 'translate3d(0, clamp(4.5rem, 13dvh, 7.5rem), 0) scale(1)',
          }}
          className="transition-transform duration-[620ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform flex flex-col items-center w-full"
        >
          <BrandLogo size="lg" phase={logoPhase} />

          <p
            style={{ fontSize: 'clamp(0.75rem, 2.2vw, 0.875rem)' }}
            className={`mt-3 text-white/60 font-medium tracking-wide text-center max-w-[34ch] transition-opacity duration-500 ${
              isLoginVisible
                ? 'opacity-100'
                : 'opacity-0 pointer-events-none'
            }`}
          >
            {isTwoFactorStep
              ? isDe
                ? 'Zwei-Faktor-Schutz aktiv. Bitte bestätige deine Identität.'
                : 'Two-Factor Protection active. Please verify your identity.'
              : isTvPairingStep
              ? isDe
                ? 'Smart TV & VIDAA Schnell-Login per Smartphone.'
                : 'Smart TV & VIDAA Quick Sign-In via Smartphone.'
              : isDe
              ? 'Melde dich an, um deine persönliche Mediathek zu öffnen.'
              : 'Sign in to access your personal cinema library.'}
          </p>
        </div>

        {/* 2. Login OR 2FA Challenge OR Smart TV QR Pairing Controls */}
        <div
          style={{ marginTop: 'clamp(1.25rem, 3.5dvh, 2rem)' }}
          className={`w-full transition-[opacity,transform] duration-[550ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[opacity,transform] ${
            isLoginVisible
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
        >
          {isTwoFactorStep ? (
            /* --- 2FA TOTP / BACKUP CODE CHALLENGE STAGE (WITH D-PAD NUMPAD FOR SMART TV) --- */
            <form
              onSubmit={handleVerifyTwoFactor}
              className="rounded-3xl bg-white/[0.06] border border-white/15 backdrop-blur-xl p-5 space-y-4 shadow-2xl animate-fade-in"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center text-white shrink-0">
                  <Shield size={19} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white truncate">
                    {useBackupCodeMode
                      ? isDe
                        ? 'Backup-Code eingeben'
                        : 'Enter Backup Code'
                      : isDe
                      ? '6-stelliger Authenticator-Code'
                      : '6-Digit Authenticator Code'}
                  </div>
                  <div className="text-xs text-white/60 truncate">
                    {auth.currentUser?.email || currentUserName || 'MovieJournal Account'}
                  </div>
                </div>
              </div>

              <div>
                <input
                  ref={twoFactorInputRef}
                  type="text"
                  inputMode={useBackupCodeMode ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  maxLength={useBackupCodeMode ? 11 : 6}
                  value={twoFactorCode}
                  onChange={(e) => {
                    const val = useBackupCodeMode
                      ? e.target.value.toUpperCase()
                      : e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                    setTwoFactorCode(val);
                    setErrorMessage(null);
                  }}
                  placeholder={useBackupCodeMode ? 'XXXX-XXXX' : '000000'}
                  className="w-full text-center font-mono tabular-nums tracking-[0.32em] text-xl font-bold py-3.5 px-4 rounded-2xl bg-black/50 border border-white/20 focus:border-white text-white placeholder-white/25 outline-none transition-colors select-text"
                />
              </div>

              {/* D-Pad On-Screen Numeric Pad for Smart TV Remotes */}
              {!useBackupCodeMode && (
                <div className="grid grid-cols-6 gap-1.5 pt-1">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      tabIndex={0}
                      onClick={() => {
                        setTwoFactorCode((prev) => (prev + digit).slice(0, 6));
                        setErrorMessage(null);
                      }}
                      className="focusable-rounded py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.18] border border-white/10 text-sm font-mono font-bold text-white transition-all"
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    tabIndex={0}
                    onClick={() => setTwoFactorCode((prev) => prev.slice(0, -1))}
                    className="focusable-rounded col-span-2 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.18] border border-white/10 text-xs font-bold text-zinc-300 transition-all"
                  >
                    ⌫ {isDe ? 'Löschen' : 'Del'}
                  </button>
                </div>
              )}

              <button
                type="submit"
                tabIndex={0}
                disabled={busyProvider === '2fa' || twoFactorCode.trim().length < 6}
                className="focusable-rounded w-full py-3.5 px-5 rounded-full bg-white text-black hover:bg-zinc-100 font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-45"
              >
                <Lock size={15} />
                <span>
                  {busyProvider === '2fa'
                    ? isDe
                      ? 'Prüfe Code...'
                      : 'Verifying...'
                    : isDe
                    ? 'Identität bestätigen'
                    : 'Verify Identity'}
                </span>
              </button>

              <div className="flex items-center justify-between pt-1 text-xs">
                <button
                  type="button"
                  tabIndex={0}
                  onClick={() => {
                    setUseBackupCodeMode((prev) => !prev);
                    setTwoFactorCode('');
                    setErrorMessage(null);
                  }}
                  className="focusable-rounded px-2 py-1 rounded-lg text-white/65 hover:text-white font-semibold transition-colors"
                >
                  {useBackupCodeMode
                    ? isDe
                      ? 'Authenticator-Code nutzen'
                      : 'Use Authenticator Code'
                    : isDe
                    ? 'Backup-Code verwenden'
                    : 'Use a Backup Code'}
                </button>

                <button
                  type="button"
                  tabIndex={0}
                  onClick={handleCancelTwoFactorChallenge}
                  className="focusable-rounded px-2 py-1 rounded-lg text-white/50 hover:text-red-300 font-medium flex items-center gap-1 transition-colors"
                >
                  <LogOut size={12} />
                  <span>{isDe ? 'Konto wechseln' : 'Switch Account'}</span>
                </button>
              </div>
            </form>
          ) : isTvPairingStep ? (
            /* --- SMART TV & HISENSE VIDAA QR-CODE + 6-DIGIT PAIRING STAGE --- */
            <div className="rounded-3xl bg-white/[0.06] border border-white/15 backdrop-blur-2xl p-5 space-y-4 shadow-2xl animate-fade-in">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center text-white shrink-0">
                    <Tv size={18} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white">
                      {isDe ? 'Smart TV & VIDAA Kopplung' : 'Smart TV & VIDAA Pairing'}
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {isDe
                        ? 'Kein Tippen auf der Fernbedienung nötig'
                        : 'No typing on your TV remote required'}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  tabIndex={0}
                  onClick={startNewTvPairingSession}
                  disabled={tvSessionLoading}
                  className="focusable-rounded p-2 rounded-full bg-white/10 hover:bg-white/20 text-zinc-300 hover:text-white transition-all"
                  title={isDe ? 'Neuen Code erzeugen' : 'Refresh code'}
                >
                  <RefreshCw size={15} className={tvSessionLoading ? 'animate-spin' : ''} />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center bg-black/45 border border-white/10 rounded-2xl p-4">
                {/* Left: Crisp QR Code for iPhone Camera Scan */}
                <div className="flex flex-col items-center justify-center">
                  {tvSession?.qrCodeSvg ? (
                    <div
                      className="w-36 h-36 p-2 rounded-2xl bg-zinc-900 border border-white/20 shadow-inner flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                      dangerouslySetInnerHTML={{ __html: tvSession.qrCodeSvg }}
                    />
                  ) : (
                    <div className="w-36 h-36 rounded-2xl bg-zinc-900 border border-white/10 flex items-center justify-center text-xs text-zinc-500 animate-pulse">
                      {isDe ? 'Lade QR-Code...' : 'Loading QR...'}
                    </div>
                  )}
                  <span className="mt-2 text-[11px] text-zinc-400 font-medium text-center">
                    {isDe ? '1. Mit iPhone-Kamera scannen' : '1. Scan with iPhone camera'}
                  </span>
                </div>

                {/* Right: 6-Digit TV Pairing Code */}
                <div className="flex flex-col items-center sm:items-start text-center sm:text-left space-y-2.5">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider font-bold text-zinc-400">
                      {isDe ? 'Oder 6-stelliger TV-Code:' : 'Or 6-Digit TV Code:'}
                    </div>
                    <div className="mt-1 font-mono text-2xl sm:text-3xl font-black tracking-[0.22em] text-white tabular-nums bg-white/[0.07] border border-white/15 px-3.5 py-2 rounded-xl">
                      {tvSession?.pairingCode
                        ? `${tvSession.pairingCode.slice(0, 3)}-${tvSession.pairingCode.slice(3)}`
                        : '•••-•••'}
                    </div>
                  </div>

                  <p className="text-[11px] text-zinc-300 leading-relaxed">
                    {isDe
                      ? 'Öffne auf deinem iPhone Einstellungen → Smart TV & VIDAA OS und gib diesen Code ein.'
                      : 'Open Settings → Smart TV & VIDAA OS on your iPhone and enter this code.'}
                  </p>

                  <div className="text-[11px] font-mono text-emerald-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>
                      {busyProvider === 'tv'
                        ? isDe
                          ? 'Verbinde Konto...'
                          : 'Linking account...'
                        : isDe
                        ? `Warte auf Bestätigung (${Math.floor(tvSecondsLeft / 60)}:${String(
                            tvSecondsLeft % 60
                          ).padStart(2, '0')})`
                        : `Waiting for approval (${Math.floor(tvSecondsLeft / 60)}:${String(
                            tvSecondsLeft % 60
                          ).padStart(2, '0')})`}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                tabIndex={0}
                onClick={() => setIsTvPairingStep(false)}
                className="focusable-rounded w-full py-3 px-4 rounded-full bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-bold text-white transition-all"
              >
                {isDe
                  ? 'Stattdessen direkt per Fernbedienung / E-Mail anmelden'
                  : 'Sign in directly with Remote / Email instead'}
              </button>
            </div>
          ) : (
            /* --- STANDARD MULTI-PROVIDER LOGIN CONTROLS --- */
            <>
              <div className="space-y-3">
                {currentUserName && onCloseModal && (
                  <button
                    type="button"
                    tabIndex={isLoginVisible ? 0 : -1}
                    onClick={onCloseModal}
                    style={{
                      paddingBlock: 'clamp(0.75rem, 2.2dvh, 1rem)',
                      fontSize: 'clamp(0.75rem, 2.2vw, 0.875rem)',
                    }}
                    className="focusable-rounded w-full flex items-center justify-center gap-2.5 px-5 rounded-full bg-white text-black hover:bg-zinc-100 font-bold tracking-wide transition-all duration-200 shadow-[0_0_40px_-8px_rgba(255,255,255,0.6)] active:scale-[0.98]"
                  >
                    <span className="truncate">
                      {isDe
                        ? `Weiter als ${currentUserName}`
                        : `Continue as ${currentUserName}`}
                    </span>
                    <ArrowRight size={15} className="flex-shrink-0" />
                  </button>
                )}

                {/* Google — Pure White Button */}
                <button
                  type="button"
                  tabIndex={isLoginVisible ? 0 : -1}
                  disabled={Boolean(busyProvider)}
                  onClick={() => handleOAuth('google')}
                  style={{
                    paddingBlock: 'clamp(0.75rem, 2.2dvh, 1rem)',
                    fontSize: 'clamp(0.75rem, 2.2vw, 0.875rem)',
                  }}
                  className="focusable-rounded w-full flex items-center justify-center gap-3 px-5 rounded-full bg-white text-black hover:bg-zinc-100 font-bold tracking-wide transition-all duration-200 shadow-[0_0_36px_-10px_rgba(255,255,255,0.45)] active:scale-[0.98] disabled:opacity-50"
                >
                  <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                    />
                  </svg>
                  <span className="truncate">
                    {busyProvider === 'google'
                      ? isDe
                        ? 'Verbinde mit Google...'
                        : 'Connecting to Google...'
                      : isDe
                      ? 'Mit Google fortfahren'
                      : 'Continue with Google'}
                  </span>
                </button>

                {/* Apple — Translucent Button */}
                <button
                  type="button"
                  tabIndex={isLoginVisible ? 0 : -1}
                  disabled={Boolean(busyProvider)}
                  onClick={() => handleOAuth('apple')}
                  style={{
                    paddingBlock: 'clamp(0.75rem, 2.2dvh, 1rem)',
                    fontSize: 'clamp(0.75rem, 2.2vw, 0.875rem)',
                  }}
                  className="focusable-rounded w-full flex items-center justify-center gap-3 px-5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-white font-bold tracking-wide border border-white/15 backdrop-blur-md transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
                >
                  <svg className="w-4 h-4 fill-current flex-shrink-0" viewBox="0 0 24 24">
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                  </svg>
                  <span className="truncate">
                    {busyProvider === 'apple'
                      ? isDe
                        ? 'Verbinde mit Apple...'
                        : 'Connecting to Apple...'
                      : isDe
                      ? 'Mit Apple fortfahren'
                      : 'Continue with Apple'}
                  </span>
                </button>

                {/* Smart TV / VIDAA QR-Code Login Button */}
                <button
                  type="button"
                  tabIndex={isLoginVisible ? 0 : -1}
                  disabled={Boolean(busyProvider)}
                  onClick={() => {
                    setErrorMessage(null);
                    setIsTvPairingStep(true);
                  }}
                  style={{
                    paddingBlock: 'clamp(0.68rem, 2dvh, 0.9rem)',
                    fontSize: 'clamp(0.72rem, 2.1vw, 0.84rem)',
                  }}
                  className="focusable-rounded w-full flex items-center justify-center gap-2.5 px-5 rounded-full bg-white/[0.05] hover:bg-white/[0.12] text-zinc-200 hover:text-white font-semibold border border-white/10 backdrop-blur-md transition-all duration-200 active:scale-[0.98]"
                >
                  <Tv size={15} className="flex-shrink-0 text-white/80" />
                  <span className="truncate">
                    {isDe
                      ? 'Smart TV / VIDAA QR-Code Login'
                      : 'Smart TV / VIDAA QR Code Sign-In'}
                  </span>
                </button>
              </div>

              {/* Subtle Optical Hairline Divider */}
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <button
                  type="button"
                  tabIndex={isLoginVisible ? 0 : -1}
                  onClick={() => {
                    setEmailExpanded((prev) => !prev);
                    setErrorMessage(null);
                    setInfoMessage(null);
                  }}
                  className="focusable-rounded text-[clamp(0.625rem,1.8vw,0.7rem)] font-bold uppercase tracking-[0.16em] text-white/60 hover:text-white transition-colors"
                >
                  {emailExpanded
                    ? isDe
                      ? 'E-Mail ausblenden'
                      : 'Hide Email'
                    : isDe
                    ? 'Oder mit E-Mail'
                    : 'Or use Email'}
                </button>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              </div>

              {/* Frameless Etched Email Form */}
              <div
                className={`transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden ${
                  emailExpanded ? 'max-h-[440px] opacity-100 mb-3' : 'max-h-0 opacity-0'
                }`}
              >
                {mode !== 'reset' && (
                  <div className="flex justify-center gap-6 mb-4 text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('login');
                        setErrorMessage(null);
                      }}
                      className={`pb-1 transition-all border-b-2 ${
                        mode === 'login'
                          ? 'text-white border-white'
                          : 'text-white/45 border-transparent hover:text-white/80'
                      }`}
                    >
                      {isDe ? 'Anmelden' : 'Sign In'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('register');
                        setErrorMessage(null);
                      }}
                      className={`pb-1 transition-all border-b-2 ${
                        mode === 'register'
                          ? 'text-white border-white'
                          : 'text-white/45 border-transparent hover:text-white/80'
                      }`}
                    >
                      {isDe ? 'Neu registrieren' : 'Create Account'}
                    </button>
                  </div>
                )}

                <form onSubmit={handleEmailSubmit} className="space-y-3.5">
                  {mode === 'register' && (
                    <div>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={isDe ? 'Dein Name (optional)' : 'Your Name (optional)'}
                        className="w-full bg-transparent border-b border-white/20 focus:border-white px-1 py-2 text-sm text-white placeholder-white/40 outline-none transition-colors select-text"
                      />
                    </div>
                  )}

                  <div>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={isDe ? 'E-Mail-Adresse' : 'Email address'}
                      className="w-full bg-transparent border-b border-white/20 focus:border-white px-1 py-2 text-sm text-white placeholder-white/40 outline-none transition-colors select-text"
                    />
                  </div>

                  {mode !== 'reset' && (
                    <div>
                      <div className="relative flex items-center">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={isDe ? 'Passwort' : 'Password'}
                          className="w-full bg-transparent border-b border-white/20 focus:border-white pl-1 pr-9 py-2 text-sm text-white placeholder-white/40 outline-none transition-colors select-text"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          aria-label="Toggle password visibility"
                          className="absolute right-1 p-1.5 text-white/45 hover:text-white transition-colors"
                        >
                          {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>

                      {mode === 'login' && (
                        <div className="flex justify-end mt-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setMode('reset');
                              setErrorMessage(null);
                            }}
                            className="text-[11px] text-white/50 hover:text-white transition-colors"
                          >
                            {isDe ? 'Passwort vergessen?' : 'Forgot password?'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pt-1.5 flex items-center gap-3">
                    {mode === 'reset' && (
                      <button
                        type="button"
                        onClick={() => setMode('login')}
                        className="px-4 py-2.5 rounded-full text-xs font-bold text-white/60 hover:text-white transition-colors"
                      >
                        {isDe ? 'Zurück' : 'Back'}
                      </button>
                    )}

                    <button
                      type="submit"
                      disabled={Boolean(busyProvider)}
                      style={{
                        paddingBlock: 'clamp(0.65rem, 2dvh, 0.85rem)',
                        fontSize: 'clamp(0.75rem, 2.2vw, 0.875rem)',
                      }}
                      className="focusable-rounded flex-1 flex items-center justify-center gap-2 rounded-full bg-white/15 hover:bg-white/25 text-white font-bold border border-white/20 transition-all disabled:opacity-50"
                    >
                      <span>
                        {busyProvider === 'email'
                          ? isDe
                            ? 'Bitte warten...'
                            : 'Please wait...'
                          : mode === 'login'
                          ? isDe
                            ? 'Mit E-Mail anmelden'
                            : 'Sign In with Email'
                          : mode === 'register'
                          ? isDe
                            ? 'Konto erstellen'
                            : 'Create Account'
                          : isDe
                          ? 'Reset-Link senden'
                          : 'Send Reset Link'}
                      </span>
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </form>
              </div>
            </>
          )}

          {errorMessage && (
            <p className="text-center text-xs font-semibold text-red-300 mt-3 animate-fade-in">
              {errorMessage}
            </p>
          )}
          {infoMessage && (
            <p className="text-center text-xs font-semibold text-emerald-300 mt-3 animate-fade-in">
              {infoMessage}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
