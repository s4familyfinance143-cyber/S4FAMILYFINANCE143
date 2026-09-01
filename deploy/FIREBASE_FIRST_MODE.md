# Firebase-first mode (no local backend)

Run S4 **without** Python backend — view and restore family data from Firebase cloud backup.

## Enable

`frontend/.env`:

```env
VITE_FIREBASE_FIRST=true
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
```

Restart: `npm run dev`

## How it works

1. Login screen shows **Firebase-only mode**
2. Sign in with Google (Firebase Auth)
3. App pulls latest Firestore snapshot → IndexedDB cache
4. Dashboard, wallets, transactions, etc. load from **offline cache**
5. Banner: *Cloud-only mode — connect backend for full editing*

## First-time setup (important)

Firebase-only mode needs an **existing cloud backup**:

1. On a PC with backend running, log in normally
2. Settings → Cloud → **Upload backup to cloud** (Firebase)
3. On phone/new device: Firebase-only sign-in → data appears

## Limitations

| Works | Does not work (without backend) |
|-------|----------------------------------|
| View cached dashboards | Create/edit transactions live |
| Restore from Firebase | Family invite / permissions API |
| Cloud auto-backup (if configured) | Celery email / reports generation |

## Switch back to full mode

Set `VITE_FIREBASE_FIRST=false` or remove it, run backend + normal login.

## Related

- `deploy/FIREBASE_SETUP.md`
- `deploy/MOBILE_SETUP.md`
