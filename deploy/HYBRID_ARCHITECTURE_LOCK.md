# S4 Family Finance — Hybrid Architecture Lock

**Status:** LOCKED (start of hybrid rollout)  
**Date:** 2026-03-04  
**Goal:** End users run EXE / APK / PWA with **no required PC backend**.

## Chosen hybrid (best of both reference systems)

| Layer | Source pattern | Family Finance rule |
|-------|----------------|---------------------|
| Auth | Invoice Tracker | Firebase Email/Password + **email verification required** |
| Local truth | Thinking App | Offline-first IndexedDB writes + outbox |
| Cloud truth | Invoice Tracker | Firestore **shared family** snapshot (`families/{id}/cloudSnapshots`) + user backup |
| Files | Firebase Storage | Documents + transaction attachments under `families/{id}/...` |
| Backup #2 | Invoice Tracker | Local JSON / folder |
| Backup #3 | Invoice Tracker | Google Drive |
| ERP / Django | Thinking App ERP | **Not adopted** for consumer Family Finance |

## Runtime modes

1. **Firebase-first / cloud-only** (default for APK + `VITE_FIREBASE_FIRST=true`)
   - Login/register via Firebase
   - Unverified email → `EmailVerificationGate` (blocked)
   - Writes go to IndexedDB; outbox pending until online
   - Flush path: `flushCloudSnapshotOutbox` → Firestore snapshot (+ clear outbox)
   - Auto backup targets: Firebase + Local folder + Drive (Settings → Cloud)

2. **Optional PC backend** (dev / advanced)
   - JWT token session
   - Outbox flush via `POST /families/{id}/sync/push`
   - Same UI; backend is optional, not required for end users

## Auth rules

- Register sends Firebase verification email
- Password users must verify before dashboard
- OAuth (Google) treated as verified when Firebase marks providers accordingly
- Override: `VITE_REQUIRE_EMAIL_VERIFICATION=0` (dev only)
- Firestore snapshot rules require `request.auth.token.email_verified == true`
  (user profile doc may still be written before verify for family_id mapping)
- Publish updated rules from `deploy/firebase/firestore.rules`

## Data path (cloud-only)

```
UI write → IndexedDB snapshot + outbox enqueue
     ↓ (online)
Firestore snapshot push  +  mark outbox synced
     ↓ (optional schedule)
Local folder JSON  +  Google Drive file
```

## Explicit non-goals (for now)

- No per-family Django/Postgres ERP server for consumer installs
- No mandatory VPS
- No “PC always on” requirement for phone/PC clients

## Related files

- `frontend/src/firebase/auth.js` — verification helpers
- `frontend/src/components/auth/EmailVerificationGate.jsx`
- `frontend/src/lib/offlineSync.js` — `flushCloudSnapshotOutbox`
- `frontend/src/firebase/cloudSync.js` — Firestore snapshot push/pull
- `frontend/src/localBackup/` + `frontend/src/googleDrive/`
- `frontend/src/lib/cloudAutoSync.js` — scheduled triple backup
- `deploy/FIREBASE_SETUP.md` · `deploy/GOOGLE_DRIVE_SETUP.md`

## QA checklist (hybrid gate)

- [ ] New register → verification screen (dashboard locked)
- [ ] Resend email works; Refresh after link unlocks app
- [ ] Unverified user cannot Sync/Restore cloud snapshot (UI + Firestore rules)
- [ ] After verify → first Firestore snapshot upload + optional backup onboarding
- [ ] Offline wallet/tx write → reconnect → cloud snapshot updates
- [ ] Settings → Cloud: Local folder + Drive + Firebase targets
- [ ] Sign out from verify screen returns to login (no half session)
- [ ] Publish `deploy/firebase/firestore.rules` to Firebase Console

## Next hybrid increments

1. Per-entity Firestore collections (beyond full snapshot) for multi-device conflict quality
2. Family invite RBAC on Firestore (owner/member roles)
3. Stronger conflict UI when two devices edit offline
