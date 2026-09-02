# Windows desktop — S4 Family Finance 143

## Normal install (recommended — Firebase, no backend)

The GitHub Release **S4-Family-Finance-143-Setup.exe** is a **Tauri** desktop app:

1. Double-click **Setup.exe**
2. Install → Finish
3. Open **S4 Family Finance 143** from Desktop or Start Menu
4. Login with Firebase email (same as APK)

No Python, no pip, no bat files, no PC backend.

### Build installer (maintainers)

Requirements: Node.js 20+, Rust stable, Windows 10/11

```powershell
cd S:\S4-FAMILY-FINANCE-143-FINAL
.\deploy\scripts\build_tauri_windows.ps1
```

Output: `S4-Family-Finance-143-Setup.exe`

---

## Legacy Option A — Inno Setup + Python backend

`deploy/installer/S4_FAMILY_FINANCE_143_InnoSetup.iss` — **deprecated** for end users.
Only for developers who run the local FastAPI backend.

---

## Development

Terminal 1 (optional backend for dev demo):

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Terminal 2:

```powershell
cd frontend
npm run dev
```

Terminal 3:

```powershell
cd desktop
npm install
npm run tauri dev
```
