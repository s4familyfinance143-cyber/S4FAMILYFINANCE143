# Mobile install — S4 Family Finance 143

No App Store required for basic use. The web app is a **PWA** (Progressive Web App).

## Android (recommended)

1. Build or host the frontend (`npm run build` → serve `frontend/dist`)
2. Open the site in **Chrome**
3. Menu → **Install app** / **Add to Home screen**
4. Sign in and use like a native app (offline cache + sync)

### Optional: APK via Trusted Web Activity (TWA)

For Play Store distribution later:

1. Use [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) or Capacitor
2. Point start URL to your hosted PWA
3. Sign APK with your keystore

## iPhone / iPad

1. Open in **Safari** (not Chrome for best PWA support)
2. Share → **Add to Home Screen**
3. Launch from home screen icon

**Note:** iOS limits background sync; use **Settings → Cloud** for Firebase/Drive backup.

## Firebase + Drive on mobile

1. Complete `deploy/FIREBASE_SETUP.md` and `deploy/GOOGLE_DRIVE_SETUP.md`
2. Add your production domain to:
   - Firebase Auth → Authorized domains
   - Google OAuth → Authorized JavaScript origins
3. Set `VITE_API_BASE` to your backend URL (or run backend on LAN)

## Local backend on phone (advanced)

Phones cannot run the Python backend locally. Options:

- **Home PC** runs backend; phone uses `http://YOUR_PC_IP:8000` in Settings → API base
- **Cloud-only backup** via Firebase/Drive without live API (restore on PC)

## GitHub release checklist

| Asset | How |
|-------|-----|
| Web/PWA | `frontend/dist` zip |
| Android | PWA install link or TWA APK |
| iPhone | PWA install link (Safari) |
| Windows | See `deploy/WINDOWS_DESKTOP.md` |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Install prompt missing | Use HTTPS; check manifest in DevTools → Application |
| Offline broken | Open app once online; wait for service worker |
| Google login fails on phone | Add domain to Firebase + OAuth origins |
| API unreachable | Set LAN IP in Settings; allow firewall on PC |
