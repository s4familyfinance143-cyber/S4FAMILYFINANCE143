# S4 Family Finance 143 — Final checklist

## ✅ Ready in code

- [x] Backend + SQLite local (`backend/.env`)
- [x] Firebase config built-in (`frontend/src/firebase/config.js`)
- [x] PWA build (`npm run build:pwa`)
- [x] Firebase Hosting config (`firebase.json`)
- [x] Android APK via Capacitor (`frontend/android`)
- [x] GitHub Release workflow (PWA zip + APK on tag `v*`)
- [x] Demo login: `owner@s4family.com` / `S4Family143!`

## 🔑 You must do once (Firebase Console)

- [x] Authentication → Email + Google ON
- [x] Firestore database created
- [x] Firestore Rules published (`deploy/firebase/firestore.rules`)
- [ ] Hosting authorized domains: `s4-family-finance.web.app` (after first deploy)

## 📱 PWA + APK release

See **`deploy/PWA_APK_RELEASE.md`**

```powershell
# PWA live (HTTPS)
.\deploy\scripts\deploy_firebase_hosting.ps1

# APK file
.\deploy\scripts\build_android_apk.ps1
```

PWA URL after deploy: **https://s4-family-finance.web.app**

## 🖥 Windows EXE (separate)

```powershell
cd backend
.\compile_windows_exe_installer_clean_v4.ps1
```

See `deploy/WINDOWS_DESKTOP.md`

## GitHub push + release

```powershell
git init
git add .
git commit -m "S4 Family Finance 143 release"
git remote add origin https://github.com/YOUR_USER/s4-family-finance.git
git push -u origin main
git tag v1.0.0
git push origin v1.0.0
```

Release assets: `s4-pwa-dist.zip` + `s4-family-finance-143-debug.apk`

Optional secret: `FIREBASE_TOKEN` from `firebase login:ci` → auto-deploy hosting on release.
