# No-money work — completion status (honest)

Updated: 2026-08-13 (evening)

## Completed (repo + device)

| Item | Proof |
|------|--------|
| 5 languages bn/en/ar/hi/ur | `npm run i18n:check` |
| Loan/budget due auto-scan | Celery Beat due scan |
| SQLCipher **config** | `npm run verify:sqlcipher` PASS |
| SQLCipher **runtime ON** | Native log `cipher_version=4.7.0 community` ✅ |
| Expo Go path | `npm run start:go` polished (heap, polling, reverse, go_v4 notes) |
| `/api/v1` + `/api/v2` | Both first-class mounts; hardened routers on v1+v2; `X-API-Version` header; `/api/v*/version` |
| Raw SQL reduction | `sync_apply` conflict/outbox helpers converted to ORM (`SyncConflict`/`SyncOutbox`) |
| Unit tests / coverage | **~81.0%** (CI floor **79.0**) ✅ |
| arm64 debug APK | Built with **embedded JS bundle**; installed on `23053RN02A` ✅ |
| Manual smoke checklist | `deploy/MANUAL_FULL_SMOKE.md` |
| Detox E2E green | **5/5 PASS** on device (`android.att.debug --reuse`) — auth + smoke ✅ |
| Mobile icon / family banner / wallet merge | mobile `9aab0ff` (needs fresh APK install on phone) |
| `.gitmodules` BOM/CRLF | Rewritten UTF-8 no BOM, LF only |

## Remaining no-money (local ops / install)

| Item | Status |
|------|--------|
| Fresh APK install on phone | **Built** + GitHub release `v1.0.6-icons-family` (install when phone connected) |
| Local Docker stack smoke | **PASS** 2026-08-13 — Postgres + Redis + MinIO + Nginx + Celery + `/api/v1`+`/api/v2` healthy |
| Local Mailpit | **PASS** — http://127.0.0.1:8025 (SMTP :1025) |
| Local Tesseract OCR | Optional PC install if image OCR needed without Vision |

## Remaining / blocked (money)

| Item | Status |
|------|--------|
| Full raw SQL wipe | Hardened phase6–9 dynamic SQL kept intentionally (schema-drift); sync_apply ORM done |
| Money ops | VPS/DNS/SSL/Firebase/Vision/AWS — out of scope |

## Ops flags

- `ENABLE_LEGACY_UNVERSIONED_API=true` restores bare `/auth`, `/families`, … mounts if needed
- Prefer `/api/v1` or `/api/v2` (same business contract; new clients may use v2)
- `/health` kept for probes; prefer `/api/v1/health` or `/api/v2/health`
