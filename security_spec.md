# MovieJournal — Firestore Security Specification (Phase 0 Security TDD)

## 1. Data Invariants

1. **Global Default-Deny**: Any path not explicitly matched is strictly denied (`allow read, write: if false;`).
2. **Owner-Only User Profile (`/users/{userId}`)**:
   - Only a signed-in, email-verified user whose `request.auth.uid == userId` can `get`, `create`, `update`, or `delete` `/users/{userId}`.
   - `list` on `/users` is strictly forbidden to prevent user enumeration or PII scraping.
   - `incoming().uid == userId` and `incoming().createdAt == request.time` on `create`.
   - On `update`, `uid` and `createdAt` are immutable (`incoming().uid == existing().uid && incoming().createdAt == existing().createdAt`), and `updatedAt == request.time`.
3. **Relational Master Gate for Subcollections (`/users/{userId}/watchlist/{mediaKey}` & `/users/{userId}/progress/{mediaKey}`)**:
   - Every access requires `isSignedIn() && request.auth.uid == userId`.
   - Subcollection `create` and `update` verify parent `/users/{userId}` exists (`exists(/databases/$(database)/documents/users/$(userId))`) and `get(/databases/$(database)/documents/users/$(userId)).data.uid == request.auth.uid`.
   - `allow list` enforces `resource.data.uid == request.auth.uid && request.auth.uid == userId` without calling `get()` inside `list`.
4. **Strict Key & Volumetric Boundaries**:
   - Every entity enforces `hasAll` and `hasOnly` key allowlists, `.size()` bounds on all strings and lists, and regex guards (`^[a-zA-Z0-9_\-]+$`) on IDs.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Shadow Field Injection on UserProfile**: `{ ..., "isAdmin": true }` -> Rejected by `hasOnly()`.
2. **Identity Spoofing on WatchlistItem**: Authenticated as `userA`, writing `{ "uid": "userB", ... }` to `/users/userA/watchlist/movie_1` -> Rejected by `incoming().uid == request.auth.uid`.
3. **Cross-Tenant Read on Watchlist**: Authenticated as `userA`, reading `/users/userB/watchlist/movie_550` -> Rejected by `request.auth.uid == userId`.
4. **Unverified Email Write**: Signed in with `email_verified: false` attempting to create `/users/userA` -> Rejected by `isVerifiedUser()`.
5. **ID Poisoning Attack**: Document ID with 300 characters or special characters (`movie_123$%`) -> Rejected by `isValidId()`.
6. **Denial-of-Wallet Oversized Overview**: `overview` string of 50,000 characters in `WatchlistItem` -> Rejected by `data.overview.size() <= 2000`.
7. **Unbounded Array Injection**: `userProviders` array with 500 elements -> Rejected by `data.userProviders.size() <= 50`.
8. **Timestamp Forgery on Create**: `createdAt` set to a past client timestamp instead of `request.time` -> Rejected by `incoming().createdAt == request.time`.
9. **Immortal Field Mutation on Update**: Changing `createdAt` or `uid` during profile update -> Rejected by immutability checks.
10. **Value Poisoning on Update**: Updating `theme` to `"hacker-mode"` or a number -> Rejected by `isValidUserProfile(incoming())` wrapper on `update`.
11. **Orphaned Subcollection Write**: Writing to `/users/userA/watchlist/movie_1` when `/users/userA` does not exist -> Rejected by `parentUserExists(userId)`.
12. **Blanket User List Scraping**: Querying `collection(db, 'users')` -> Rejected because `allow list` is not granted on `/users/{userId}`.
