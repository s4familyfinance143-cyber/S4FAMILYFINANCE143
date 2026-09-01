# S4 Desktop (Tauri)

Native window for the S4 web UI.

## Prerequisites

1. [Rust](https://rustup.rs/) (`rustup default stable`)
2. Node.js 20+
3. Backend running at `http://127.0.0.1:8000` for full finance API

## Commands

```powershell
npm install
npm run dev      # needs frontend dev server + backend
npm run build    # builds ../frontend/dist then packages .exe/.msi
```

Full guide: `../deploy/WINDOWS_DESKTOP.md`

## Icons

Replace placeholder icons in `src-tauri/icons/` before store release.
Generate from `../frontend/public/favicon.svg` using [Tauri icon tool](https://v2.tauri.app/reference/cli/#icon).
