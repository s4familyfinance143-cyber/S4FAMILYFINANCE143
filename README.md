# S4 Family Finance 143

**Self-hosted family finance platform** — income, expenses, grocery lists, loans, budgets, and savings for the whole family. Everything runs on **your own VPS** (FastAPI + PostgreSQL + Redis); the web app, PWA, Android APK and Windows EXE all talk to that server. Code lives on GitHub. No third-party cloud database.

[![Release](https://img.shields.io/github/v/release/s4familyfinance143-cyber/S4FAMILYFINANCE143)](https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143/releases)
[![License](https://img.shields.io/badge/license-Private-red)]()

---

## Features

| Area | What you get |
|------|----------------|
| **Finance** | Wallets, transactions, budgets, loans, savings goals |
| **Family** | Multi-member families, roles, invites, approvals |
| **Live updates** | Changes by one family member appear on the others' screens over the VPS WebSocket |
| **Offline** | Local SQLite + IndexedDB cache with a sync outbox — keeps working without internet, syncs to the VPS when back online |
| **Backup** | Family-scoped export from the VPS, plus optional local folder / Google Drive copy |
| **Platforms** | Web, PWA, Android APK, Windows EXE |
| **Languages** | English, বাংলা, Hindi, Arabic, Urdu |

---

## Quick start (PC, local development)

### Requirements

- Windows 10/11
- Python 3.11+
- Node.js 20+

### Setup

```powershell
git clone https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143.git
cd S4FAMILYFINANCE143
.\setup_local.ps1
.\start_dev.ps1
```

Open: **http://127.0.0.1:5173** (API: http://127.0.0.1:8000)

### Login

Register an account on the server (email + phone, OTP verification), then create or join a family from the login screen. No shared demo password is published.

---

## Production (VPS)

Live app: **https://app.s4businessthinking.com** (API under `/api/v1`).

Pushing to `main` deploys automatically to the VPS (`.github/workflows/auto-deploy-vps.yml`): rsync, Docker rebuild, `alembic upgrade head`, health checks. **Take a `pg_dump` backup before merging anything that touches the database.**

See [`deploy/OPERATOR_GO_LIVE.md`](deploy/OPERATOR_GO_LIVE.md).

---

## Download (Releases)

Go to **[Releases](https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143/releases)** and download:

| File | Platform |
|------|----------|
| `S4-Family-Finance-143-PWA.zip` | PWA — self-host |
| `S4-Family-Finance-143-Setup.exe` | Windows PC installer |
| `S4-Family-Finance-143.apk` | Android phone |

### PWA install (phone)

1. Open **https://app.s4businessthinking.com**
2. **Android:** Chrome → Menu → **Install app**
3. **iPhone:** Safari → Share → **Add to Home Screen**

### Android APK

Download APK from Releases → install on phone (allow unknown sources). The app connects to the VPS server by default.

### Windows EXE (Tauri)

```powershell
cd desktop
npm install
npm run build
```

Installer output is under `desktop/src-tauri/target/release/bundle/nsis/`.

Or use GitHub Actions **Release** workflow artifacts.

---

## Project structure

```
S4FAMILYFINANCE143/
├── backend/          # FastAPI API — the single source of truth (VPS)
├── frontend/         # React + Vite PWA (primary UI)
│   └── android/      # Capacitor Android — official APK
├── desktop/          # Tauri Windows EXE (official desktop)
├── mobile/           # Expo React Native app (talks to the same VPS API)
├── deploy/           # Docker, Nginx, VPS scripts and docs
├── setup_local.ps1   # One-time local setup
└── start_dev.ps1     # Start backend + frontend
```

---

## Build Android APK locally

```powershell
.\deploy\scripts\build_android_apk.ps1
```

Requires Java JDK 21 + Android SDK (Android Studio).

---

## GitHub backup

This repository is the **full code backup**:

```powershell
git clone https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143.git
```

Finance **data** is not in Git — it lives in PostgreSQL on the VPS. Back it up with `pg_dump` on the server; each family OWNER can also download a family export from Settings → Backup.

---

## Documentation

| Doc | Topic |
|-----|-------|
| [`deploy/OPERATOR_GO_LIVE.md`](deploy/OPERATOR_GO_LIVE.md) | VPS go-live |
| [`deploy/PWA_APK_RELEASE.md`](deploy/PWA_APK_RELEASE.md) | PWA + APK release |
| [`deploy/WINDOWS_DESKTOP.md`](deploy/WINDOWS_DESKTOP.md) | Windows EXE |
| [`deploy/MOBILE_SETUP.md`](deploy/MOBILE_SETUP.md) | Phone install |

---

## License

Private family finance project — all rights reserved.
