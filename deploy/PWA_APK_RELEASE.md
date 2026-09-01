# PWA + APK release — S4 Family Finance 143

## What is ready in code

| Asset | Status |
|-------|--------|
| **PWA** | `npm run build:pwa` → `frontend/dist` |
| **Firebase Hosting** | `firebase.json` → `frontend/dist` |
| **Android APK** | Capacitor → `frontend/android` |
| **Production mode** | `.env.production` → `VITE_FIREBASE_FIRST=true` (no VPS) |

---

## 1. PWA (phone install from website)

### Build

```powershell
cd frontend
npm run build:pwa
```

### Deploy to Firebase Hosting (free HTTPS)

```powershell
# One-time: install CLI + login
npm install -g firebase-tools
firebase login

# Deploy
cd S:\S4-FAMILY-FINANCE-143-FINAL
firebase deploy --only hosting --project s4-family-finance
```

Your PWA URL: **https://s4-family-finance.web.app**

### Phone install

- **Android:** Chrome → open URL → Menu → **Install app**
- **iPhone:** Safari → Share → **Add to Home Screen**

### Firebase Console (one-time)

Authentication → **Authorized domains** → add:
- `s4-family-finance.web.app`
- `s4-family-finance.firebaseapp.com`

---

## 2. Android APK

### Build on your PC (needs Java 21 + Android Studio SDK)

```powershell
cd frontend
npm run build:android
cd android
.\gradlew.bat assembleDebug
```

APK path:
`frontend\android\app\build\outputs\apk\debug\app-debug.apk`

Rename and share: `S4-Family-Finance-143.apk`

### Or: GitHub Release (auto)

```powershell
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions builds:
- `s4-pwa-dist.zip`
- `s4-family-finance-143-debug.apk`

---

## 3. GitHub secrets (optional auto-hosting)

| Secret | How |
|--------|-----|
| `FIREBASE_TOKEN` | `firebase login:ci` → paste token in GitHub repo Settings → Secrets |

Without this secret, release still uploads PWA zip + APK — only auto-hosting is skipped.

---

## 4. User flow (no VPS)

1. Install PWA or APK
2. Open app → **Firebase-only mode** / Google sign-in
3. **Restore from cloud** (after PC backup uploaded once)
4. View family finance from Firebase cache

For full edit on phone: home PC runs backend + set LAN IP in Settings, OR use PC/EXE.

---

## Commands cheat sheet

```powershell
# Local dev (PC with backend)
.\start_dev.ps1

# PWA production build
cd frontend && npm run build:pwa

# APK build
cd frontend && npm run build:android
cd android && .\gradlew.bat assembleDebug

# Firebase hosting deploy
firebase deploy --only hosting
```
