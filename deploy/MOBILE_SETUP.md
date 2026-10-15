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

**Note:** iOS limits background sync; the app syncs to the VPS whenever it is open and online.

## Server connection on mobile

1. The app uses the VPS API by default (`https://app.s4businessthinking.com`).
2. Optional Google Drive backup: complete `deploy/GOOGLE_DRIVE_SETUP.md` and add your
   production domain to Google OAuth → Authorized JavaScript origins.
3. For local testing, set the API base to your PC on the same Wi-Fi.

## Local backend on phone (advanced)

Phones cannot run the Python backend locally. Options:

- **Home PC** runs backend; phone uses `http://YOUR_PC_IP:8000` in Settings → API base
- **Production VPS** — the default; nothing to run at home

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
| Google Drive connect fails on phone | Add the domain to Google OAuth origins |
| API unreachable | Set LAN IP in Settings; allow firewall on PC |
