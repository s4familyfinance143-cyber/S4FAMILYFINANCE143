# Build Order gaps — code vs operator

In-repo packaging/code status. **Live production still needs operator spend/accounts.**

| Step | Code / packaging | Operator / paid | How to prove |
|------|------------------|-----------------|--------------|
| **6** SQLite / SQLCipher | **Code COMPLETE** (config + verify script) | Native/EAS binary + device runtime `cipher_version` | `cd mobile && npm run verify:sqlcipher` then native build per `mobile/docs/SQLCIPHER_NATIVE_BUILD.md` |
| **12** Push / FCM | **Code COMPLETE** (templates + Celery + outbox) | Firebase project JSON + real device | `bash deploy/scripts/verify_fcm_ready.sh` + credentials |
| **18** Security + Beta | **Artifacts COMPLETE** (audit report + beta plan + issue template) | Real 2–3 family beta run | `deploy/SECURITY_AUDIT_REPORT.md` + `deploy/BETA_TESTING_PLAN.md` |
| **19** Production Live | **Packaging COMPLETE** (compose, nginx, scripts, CI images) | VPS + DNS + SSL + filled secrets | `deploy/OPERATOR_GO_LIVE.md` |

## Operator-only (cannot be invented by code)

1. Ubuntu VPS IP  
2. DNS A records  
3. Firebase / Sentry / Slack webhook accounts  
4. Real beta testers  

After those exist, Step 19 Output (`🚀 S4-FAMILY Live`) is reachable.
