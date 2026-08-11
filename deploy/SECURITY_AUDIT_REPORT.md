# S4 Family Finance 143 — Security Audit Report
**Date:** 2026-08-11  
**Scope:** Backend (`app/`), Frontend npm dependencies, CI gates  
**Method:** Bandit static analysis + `npm audit --audit-level=high` + architecture control review  

## Executive summary

| Gate | Result |
|------|--------|
| Bandit High severity | **0** |
| npm audit (high+) | **0 vulnerabilities** |
| CI security job (bandit) | Enabled in `.github/workflows/ci.yml` |
| Production secrets in git | Blocked by `.gitignore` / examples only |
| Go-live blockers | Operator VPS/DNS/TLS (not code defects) |

**Verdict:** No High findings in static gates. Cleared for **local/staging packaging and paid-beta prep**; a real multi-family beta and live hosting are still **operator** steps (see `OPERATOR_GO_LIVE.md`).

## Automated results

### Bandit (backend)

```
Total issues: High=0, Medium=40, Low=34
```

Notable Medium (low confidence):
- `B608` in `app/services/sync_apply.py` — dynamic SQL for `sync_outbox` uses **bound parameters** (`:limit`) and clause fragments from an internal allowlist, not raw user SQL. Accepted risk; keep allowlist discipline.
- Assorted `try/except/pass` (`B110`) in sync payload coercion — Low/Medium noise; does not expose auth bypass.

### npm audit (frontend)

```
found 0 vulnerabilities (audit-level=high)
```

## Control checklist (architecture)

| Control | Status | Evidence |
|---------|--------|----------|
| JWT auth + refresh | Pass | `backend/app/api/v1/auth.py` |
| Rate limiting | Pass | SlowAPI / auth limits |
| Password hashing | Pass | bcrypt via security helpers |
| RBAC / permissions | Pass | `permission_service` + family governance |
| Audit trail | Pass | `audit_logs` + Admin UI |
| HTTPS edge | Ready | nginx + SSL example conf |
| Secrets not committed | Pass | `.env*.example` only |
| SQLCipher offline DB | Ready (native build) | `mobile/docs/SQLCIPHER_NATIVE_BUILD.md` |
| Sentry exception tracking | Ready (DSN optional) | backend + web + celery wiring |
| Dependency scanning in CI | Pass | bandit + npm audit jobs |

## Residual risks (accepted for beta)

1. Live FCM / SMTP credentials not installed until operator configures them.
2. Production domain TLS until Certbot/Cloudflare is applied on VPS.
3. Real-user abuse testing happens in beta (see `deploy/BETA_TESTING_PLAN.md`).

## Sign-off

- **Automated security gate:** PASS (no High)  
- **Recommended next:** Beta with 2–3 families → fix feedback → Production Deploy (`deploy/OPERATOR_GO_LIVE.md`)

Re-run:
```bash
cd backend && python -m bandit -r app -c ../.bandit
cd frontend && npm run audit:ci
```
