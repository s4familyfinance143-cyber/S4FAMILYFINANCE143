# Google Drive backup — S4 Family Finance

Use your own Google account. Backup files are stored in your Drive under the app folder `S4 Family Finance Backups`.

## Prerequisites

- Firebase project already created (see `deploy/FIREBASE_SETUP.md`)
- Same Google Cloud project powers Firebase and OAuth

## 1. Enable Google Drive API

1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Select your Firebase project
3. **APIs & Services → Library**
4. Search **Google Drive API** → **Enable**

## 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External** (or Internal for workspace)
3. App name: `S4 Family Finance`
4. Add your email as developer contact
5. **Scopes** → add: `https://www.googleapis.com/auth/drive.file`
6. **Test users** (while in Testing): add the Google accounts you will use

## 3. Create OAuth Web client ID

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `S4 Web Drive`
4. **Authorized JavaScript origins** (add all you use):
   - `http://localhost:5173`
   - `http://127.0.0.1:5173`
5. **Authorized redirect URIs**: leave empty (GIS token flow uses popup, no redirect)
6. Copy the **Client ID** into `frontend/.env`:

```env
VITE_GOOGLE_CLIENT_ID=123456789-xxxx.apps.googleusercontent.com
```

7. Restart: `npm run dev`

## 4. Use in the app

1. Log in to S4 (local backend)
2. **Settings → Cloud**
3. **Google Drive** section → **Connect Google Drive**
4. **Upload backup to Drive** — creates/updates JSON backup in your Drive
5. New device: **Connect** → **Restore latest from Drive**

## Notes

- `drive.file` scope only sees files created by this app (not your whole Drive)
- Tokens are stored in `localStorage` on this browser
- Drive backup is separate from Firebase; you can use one or both
- For production hosting, add your domain to OAuth authorized origins

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Drive section says not configured | Set `VITE_GOOGLE_CLIENT_ID` and restart Vite |
| `access_denied` / popup closed | Allow popups; add account as OAuth test user |
| `redirect_uri_mismatch` | Check authorized origins match exact URL (port included) |
| No files on restore | Upload a backup first from **Upload backup to Drive** |
