## Hybrid architecture (locked)

See **`deploy/HYBRID_ARCHITECTURE_LOCK.md`**:

- Firebase Email/Password + **email verification required**
- Offline-first IndexedDB + outbox
- Cloud truth = Firestore snapshot
- Extra backups = Local folder JSON + Google Drive
- No required PC backend / Django ERP for end users

## 1. Create project

1. Open [Firebase Console](https://console.firebase.google.com/)
2. **Add project** → name e.g. `s4-family-finance`
3. Disable Google Analytics (optional) → Create

## 2. Enable Authentication

1. **Build → Authentication → Get started**
2. Enable **Email/Password**
3. Enable **Google** (add support email when asked)

## 3. Create Firestore database

1. **Build → Firestore Database → Create database**
2. Start in **production mode** (we deploy rules below)
3. Pick region close to users (e.g. `asia-south1` for Bangladesh)

## 4. Deploy security rules

1. Firebase Console → Firestore → **Rules**
2. Paste contents of `deploy/firebase/firestore.rules`
3. **Publish** (rules require **email verified** for cloud snapshot read/write).
   Owners may update family `currency` / `default_currency` / `timezone` on `families/{familyId}`.

4. Firebase Console → Storage → **Get started** (enable Storage; Blaze may be required for cross-service rules)
5. Storage → **Rules** → paste `deploy/firebase/storage.rules` → **Publish**

Or with Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,storage --project s4-family-finance
```

Shared family paths used by the app:

- `users/{uid}/cloudSnapshots/latest` — personal backup
- `families/{familyId}/members/{uid}` — RBAC
- `families/{familyId}/cloudSnapshots/latest` — shared family truth
- `familyInvites/{CODE}` — cross-account invite join
- Storage `families/{familyId}/documents|attachments/...` — real file uploads


## 5. Register web app

1. Project **Settings** (gear) → **Your apps** → **Web** `</>`
2. App nickname: `S4 Web`
3. Config is already in **`frontend/src/firebase/config.js`** (`s4-family-finance`).
   If you create a **new** Firebase project, replace `firebaseConfig` in that file.

4. Restart frontend: `npm run dev`

## 6. Authorized domains (local dev)

Authentication → **Settings → Authorized domains** should include:

- `localhost`
- `127.0.0.1`

## 7. Use in the app

1. Log in to S4 (local backend as today)
2. **Settings → Cloud** tab
3. **Sign in with Google** (or email cloud account)
4. **Upload backup to cloud** — saves offline cache to Firestore
5. New PC/phone: install app → Cloud sign-in → **Restore from cloud**

## Free tier tips

- Backup uploads only on button press (not every click)
- Large data is split into chunks automatically
- For heavy file backup: use **Google Drive** or **local folder** (Settings → Cloud)

## 8. Google Drive backup (optional)

See **`deploy/GOOGLE_DRIVE_SETUP.md`** for:

- Enabling Drive API in the same GCP project
- OAuth Web client ID → `VITE_GOOGLE_CLIENT_ID` in `frontend/.env`
- Connect / upload / restore from **Settings → Cloud**

## Blaze billing (optional later)

- Firestore free tier is enough for early users
- Cloud Storage for files needs Blaze plan (pay-as-you-go with free quota)

## Instant verification email (recommended)

Firebase Auth’s built-in mailer can take minutes on free/Spark. For near-instant delivery:

1. Deploy a small HTTPS API (Cloud Function or your backend) that:
   - Verifies `Authorization: Bearer <Firebase ID token>`
   - Calls `admin.auth().generateEmailVerificationLink(email)`
   - Sends that link via **Resend / Brevo / SMTP (Nodemailer)**
2. Set in `frontend/.env`:
   `VITE_CUSTOM_VERIFY_EMAIL_URL=https://your-api/verify-email`
3. Restart Vite. The app still calls `sendEmailVerification` immediately on signup, and also POSTs to this URL in parallel.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Cloud tab says not configured | Fill `frontend/.env` and restart Vite |
| Google popup blocked | Allow popups for `127.0.0.1:5173` |
| Permission denied | Publish `firestore.rules` |
| `auth/unauthorized-domain` | Add domain in Firebase Auth settings |
| Verification email delayed | Use `VITE_CUSTOM_VERIFY_EMAIL_URL` (above); check spam; Auth → Templates |
