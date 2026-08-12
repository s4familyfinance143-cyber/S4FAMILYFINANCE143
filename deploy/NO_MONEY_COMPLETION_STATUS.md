# No-money work — completion status (honest)

Updated: 2026-08-12 (night)

## Completed (repo + device)

| Item | Proof |
|------|--------|
| 5 languages bn/en/ar/hi/ur | `npm run i18n:check` |
| Loan/budget due auto-scan | Celery Beat due scan |
| SQLCipher **config** | `npm run verify:sqlcipher` PASS |
| SQLCipher **runtime ON** | Native log `cipher_version=4.7.0 community` ✅ |
| Expo Go path | `npm run start:go` polished (heap, polling, reverse, go_v4 notes) |
| `/api/v1` primary | Bare unversioned `api_router` **off by default** (`ENABLE_LEGACY_UNVERSIONED_API=False`); hardened routers mounted under `/api/v1` |
| Raw SQL reduction | `sync_apply` conflict/outbox helpers converted to ORM (`SyncConflict`/`SyncOutbox`) |
| Unit tests / coverage | **~81.0%** (floor 79.0) ✅ |
| arm64 debug APK | Built with **embedded JS bundle**; installed on `23053RN02A` ✅ |
| Manual smoke checklist | `deploy/MANUAL_FULL_SMOKE.md` |
| Detox E2E green | **5/5 PASS** on device (`android.att.debug --reuse`) — auth + smoke ✅ |

## Remaining / blocked

| Item | Status |
|------|--------|
| Full raw SQL wipe | Hardened phase6–9 dynamic SQL kept intentionally (schema-drift); sync_apply ORM done |
| Money ops | VPS/DNS/SSL/Firebase — out of scope |

## Ops flags

- `ENABLE_LEGACY_UNVERSIONED_API=true` restores bare `/auth`, `/families`, … mounts if needed
- `/health` kept for probes; prefer `/api/v1/health`
