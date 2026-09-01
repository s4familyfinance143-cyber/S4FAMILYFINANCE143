# S4 Family Finance 143

**Offline-first family finance platform** — income, expenses, grocery lists, loans, budgets, and savings for the whole family. Works on **PC, PWA (phone install), and Android APK** without a VPS.

[![Release](https://img.shields.io/github/v/release/s4familyfinance143-cyber/S4FAMILYFINANCE143)](https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143/releases)
[![License](https://img.shields.io/badge/license-Private-red)]()

---

## Features

| Area | What you get |
|------|----------------|
| **Finance** | Wallets, transactions, budgets, loans, savings goals |
| **Family** | Multi-member families, roles, invites, approvals |
| **Offline** | Local SQLite + IndexedDB cache — works without internet |
| **Cloud backup** | Firebase (no VPS), Google Drive, local folder |
| **Platforms** | Web, PWA, Android APK, Windows EXE |
| **Languages** | English, বাংলা, Hindi, Arabic, Urdu |

---

## Quick start (PC)

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

Open: **http://127.0.0.1:5173**

### Demo login

| Field | Value |
|-------|-------|
| Email | `owner@s4family.com` |
| Password | `S4Family143!` |

---

## Download (Releases)

Go to **[Releases](https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143/releases)** and download:

| File | Platform |
|------|----------|
| `s4-family-finance-143-debug.apk` | Android phone |
| `s4-pwa-dist.zip` | Self-host PWA |
| Windows EXE | Build locally (see below) |

### PWA install (phone)

1. Deploy or use hosted URL: `https://s4-family-finance.web.app`
2. **Android:** Chrome → Menu → **Install app**
3. **iPhone:** Safari → Share → **Add to Home Screen**

### Android APK

Download APK from Releases → install on phone (allow unknown sources).

### Windows EXE

```powershell
cd backend
.\compile_windows_exe_installer_clean_v4.ps1
```

Requires [Inno Setup 6](https://jrsoftware.org/isinfo.php).

---

## Cloud backup (no VPS)

Firebase is built into the app (`frontend/src/firebase/config.js`).

1. Firebase Console → enable **Authentication** (Email + Google) and **Firestore**
2. Publish rules from `deploy/firebase/firestore.rules`
3. In app: **Settings → Cloud** → Sign in → **Upload backup to cloud**
4. New device: Sign in → **Restore from cloud**

Guides: [`deploy/FIREBASE_SETUP.md`](deploy/FIREBASE_SETUP.md) · [`deploy/GOOGLE_DRIVE_SETUP.md`](deploy/GOOGLE_DRIVE_SETUP.md)

---

## Project structure

```
S4FAMILYFINANCE143/
├── backend/          # FastAPI + SQLite API
├── frontend/         # React + Vite PWA
│   └── android/      # Capacitor Android APK
├── deploy/           # Hosting, Firebase, installer docs
├── desktop/          # Tauri desktop shell (optional)
├── setup_local.ps1   # One-time local setup
└── start_dev.ps1     # Start backend + frontend
```

---

## Deploy PWA to Firebase Hosting

```powershell
.\deploy\scripts\deploy_firebase_hosting.ps1
```

Live URL: **https://s4-family-finance.web.app**

---

## Build Android APK locally

```powershell
.\deploy\scripts\build_android_apk.ps1
```

Requires Java JDK 21 + Android SDK (Android Studio).

---

## GitHub backup

This repository is your **full project backup**. If USB or local files are lost:

```powershell
git clone https://github.com/s4familyfinance143-cyber/S4FAMILYFINANCE143.git
```

Finance **data** is not in Git — use **Firebase / Google Drive / local folder** backup in Settings → Cloud.

---

## Documentation

| Doc | Topic |
|-----|-------|
| [`SETUP_COMPLETE.md`](SETUP_COMPLETE.md) | Checklist |
| [`deploy/PWA_APK_RELEASE.md`](deploy/PWA_APK_RELEASE.md) | PWA + APK release |
| [`deploy/WINDOWS_DESKTOP.md`](deploy/WINDOWS_DESKTOP.md) | Windows EXE |
| [`deploy/MOBILE_SETUP.md`](deploy/MOBILE_SETUP.md) | Phone install |
| [`deploy/FIREBASE_SETUP.md`](deploy/FIREBASE_SETUP.md) | Firebase Console |

---

## License

Private family finance project — all rights reserved.
