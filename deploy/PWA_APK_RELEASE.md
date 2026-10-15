# PWA + APK release — S4 Family Finance 143

All clients talk to the VPS API (`https://app.s4businessthinking.com/api/v1`). There is no third-party cloud backend.

## What is ready in code

| Asset | Status |
|-------|--------|
| **PWA** | `npm run build:pwa` → `frontend/dist`, served by Nginx on the VPS |
| **Android APK** | Capacitor → `frontend/android` |
| **Production API** | `VITE_API_BASE=/api/v1` (same origin as the VPS site) |

---

## 1. PWA (phone install from the website)

The PWA is deployed together with the backend: merging to `main` runs
`.github/workflows/auto-deploy-vps.yml`, which rebuilds the frontend image on the VPS.

### Build locally (optional check)

```powershell
cd frontend
npm run build:pwa
```

### Phone install

Open **https://app.s4businessthinking.com**, then:

- **Android:** Chrome → Menu → **Install app**
- **iPhone:** Safari → Share → **Add to Home Screen**

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

## 3. User flow

1. Install the PWA or APK.
2. Register / log in to the VPS account, create or join a family.
3. Data is stored on the VPS; the device keeps an offline cache and a sync outbox.
4. Changes made by other family members show up live (VPS WebSocket).

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
```
