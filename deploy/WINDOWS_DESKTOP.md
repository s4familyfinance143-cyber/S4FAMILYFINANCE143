# Windows desktop — S4 Family Finance 143

Two ways to ship a Windows `.exe`:

## Option A — Full installer (recommended, includes backend)

Bundles Python backend + SQLite + frontend. No VPS needed.

### Requirements

- Windows 10/11
- [Inno Setup 6](https://jrsoftware.org/isinfo.php)
- Node.js (frontend build)
- Python 3.11+ venv in `backend/.venv`

### Build

```powershell
cd S:\S4-FAMILY-FINANCE-143-FINAL\backend
.\compile_windows_exe_installer_clean_v4.ps1
```

Or manually:

1. `cd frontend && npm run build`
2. Open `deploy/installer/S4_FAMILY_FINANCE_143_InnoSetup.iss` in Inno Setup
3. **Compile** → produces `S4-FAMILY-FINANCE-143-Setup.exe`

### After install

- Backend starts as Windows service or shortcut (per installer script)
- Browser opens `http://127.0.0.1:8000` or embedded static UI
- Cloud backup: Settings → Cloud (local folder / Drive / Firebase)

See `deploy/installer/README_INSTALLER.md`.

---

## Option B — Tauri lightweight shell

Smaller `.exe` that opens the UI in a native window. **Backend must run separately** (or use Option A).

### Requirements

- [Rust](https://rustup.rs/)
- Node.js 20+

### Setup (one time)

```powershell
cd S:\S4-FAMILY-FINANCE-143-FINAL\desktop
npm install
```

### Development

1. Terminal 1: `cd backend && .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000`
2. Terminal 2: `cd frontend && npm run dev`
3. Terminal 3: `cd desktop && npm run tauri dev`

### Release build

```powershell
cd frontend
npm run build
cd ..\desktop
npm run tauri build
```

Output: `desktop/src-tauri/target/release/bundle/msi/` or `nsis/`

### Configure API URL

In the installed Tauri app, set **Settings → API base** to `http://127.0.0.1:8000` (default).

---

## GitHub Releases

Upload:

1. `S4-FAMILY-FINANCE-143-Setup.exe` (Option A)
2. Optional: Tauri `.msi` / `.exe` (Option B)
3. `frontend-dist.zip` for self-hosting PWA

## Cloud backup without VPS

Users do **not** need a server for backup:

- **Local folder** — PC disk
- **Google Drive** — own account (`deploy/GOOGLE_DRIVE_SETUP.md`)
- **Firebase** — free tier sync (`deploy/FIREBASE_SETUP.md`)

Finance features still need the local backend (Option A installer).
