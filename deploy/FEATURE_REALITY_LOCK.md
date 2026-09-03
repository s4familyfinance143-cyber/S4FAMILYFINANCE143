# S4 Family Finance — Feature Reality Lock

**Status:** LOCKED · Firebase = server for end users  
**Date:** 2026-09-04  
**Rule:** Cloud-only (`isCloudLocalMode`) uses IndexedDB + Firestore shared family snapshot + Firebase Storage. No PC backend required.

## Legend

| Tag | Meaning |
|-----|---------|
| **REAL** | Works with Firebase cloud account (no PC API) |
| **PARTIAL** | Works; optional external provider (SMTP/FCM VAPID) not required for core use |
| **BACKEND** | Dev/advanced JWT PC API only |

## Auth

| Option | Status |
|--------|--------|
| Firebase login / register / verify | REAL |
| Cloud backup onboarding | REAL |

## Finance

| Menu | Status |
|------|--------|
| Dashboard, Wallets, Transactions, Budgets, Savings, Loans, Goals, Recurring | REAL |
| Currency center | REAL |
| Tags + transaction tags | REAL |
| Split expense / cutover tools | REAL |

## Family & daily life

| Menu | Status | Notes |
|------|--------|-------|
| Family members + invite codes | REAL | Codes published to `familyInvites/{code}`; join switches account to shared family |
| Roles / permissions | REAL | OWNER / MEMBER in `families/{id}/members` |
| Planner (tasks + calendar) | REAL | via shim |
| Grocery lists / items / vendors | REAL | via shim |
| Health / Investment / Vehicle / Education | REAL | phase15 via shim |
| Subscriptions / Property / Documents | REAL | phase16; **files → Firebase Storage** |
| Zakat calculate + metal rates | REAL | via shim |
| Notifications (in-app + browser) | REAL | in-app list + browser Notification API; optional FCM VAPID later |
| Audit trail | REAL | local event log synced to cloud snapshot |

## System

| Menu | Status |
|------|--------|
| Backup Firebase / Drive / Local | REAL |
| Offline sync panel | REAL (flush = user + shared family snapshot) |
| Cutover / architecture readiness | REAL (cloud readiness panel) |
| Document / attachment upload | REAL (Firebase Storage) |

## Implementation map

- `frontend/src/lib/cloudApiShim.js` — Firebase-first API for all listed menus
- `frontend/src/firebase/familyCloud.js` — shared family snapshot + invites + members
- `frontend/src/firebase/cloudStorage.js` — document/attachment uploads
- `deploy/firebase/firestore.rules` + `storage.rules` — **must Publish in Console**
- Seed: `seedCloudModuleCaches` on family create / session activate

## Operator checklist (not code)

1. Publish Firestore + Storage rules (see `deploy/FIREBASE_SETUP.md`)
2. Enable Firebase Storage in Console
3. Optional: Play Store upload keystore for store listing (CI ships release APK signed for sideload)

## Version lock

All targets: **1.0.12** · Capacitor APK official · Expo secondary · Tauri Windows CSP locked · PWA (Safari/Chrome)
