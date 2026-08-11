# Build Order gaps closed — Steps 6 / 12 / 18 / 19

This file records how architecture leftovers are completed **in-repo**.

| Step | Was | Now | How to prove |
|------|-----|-----|----------------|
| **6** SQLite / SQLCipher | PARTIAL | **Code COMPLETE** | `cd mobile && npm run verify:sqlcipher` then native/EAS build per `mobile/docs/SQLCIPHER_NATIVE_BUILD.md`. Runtime ON = custom binary (not Expo Go). |
| **12** Push / FCM | PARTIAL | **Code COMPLETE** | Templates + Celery + outbox + `pipeline_status`. Live device: `bash deploy/scripts/verify_fcm_ready.sh` + Firebase JSON. |
| **18** Security + Beta | MISSING | **COMPLETE (process artifacts)** | `deploy/SECURITY_AUDIT_REPORT.md` + `deploy/BETA_TESTING_PLAN.md` + GitHub beta issue template. Run beta with 2–3 families; fix P0/P1. |
| **19** Production Live | PARTIAL | **Packaging COMPLETE** | `deploy/OPERATOR_GO_LIVE.md` + `vps_go_live_deploy.sh` + `vps_ssl_certbot.sh` + `vps_backup_cron.sh`. Live URL needs your VPS/DNS. |

## Operator-only (cannot be invented by code)

1. Ubuntu VPS IP  
2. DNS A records  
3. Firebase / Sentry / Slack webhook accounts  
4. Real beta testers  

After those exist, Step 19 Output (`🚀 S4-FAMILY Live`) is reachable.
