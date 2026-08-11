# No-money work — completion status (honest)

Updated: 2026-08-11

## Completed (repo)

| Item | Proof |
|------|--------|
| 5 languages bn/en/ar/hi/ur | `npm run i18n:check` → 784 keys × 5 (web); mobile 597 × 5 |
| Loan/budget due auto-scan | Celery Beat `scan_due_notifications_task` every `LOAN_REMINDER_SCAN_HOURS` |
| Detox scaffold (language-safe) | `mobile/e2e/*` uses `by.id()`; `docs/DETOX_RUN.md` |
| SQLCipher config | `npm run verify:sqlcipher` PASS |
| `/api/v1` primary path | Frontend + nginx `/api/v1`; legacy mounts deprecated |
| Raw SQL reduction | Several safe ORM conversions; full rewrite not done |
| Unit tests | ~193 tests; coverage **~42.9%** (floor 40.9%) |

## Not finished to architecture “100%”

| Item | Why | Next action |
|------|-----|-------------|
| Coverage **80%** | App has ~16k statements; ~43% now. Jumping overnight breaks CI honesty. | Keep adding tests each session until 80 |
| SQLCipher **runtime ON** | Needs custom native APK on device (not Expo Go) | `cd mobile && npm run android:apk` then install + check `cipher_version` |
| Detox **full run** | Needs online emulator/AVD matching `DETOX_AVD` | Start AVD, then `npm run test:e2e:build && npm run test:e2e` |
| Remove all raw SQL + drop unversioned API | High regression risk | Incremental PRs only |

## Money still separate

VPS / DNS / SSL / Firebase / real beta families — not part of this list.
