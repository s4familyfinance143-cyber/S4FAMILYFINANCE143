# Beta Testing Plan — S4 Family Finance 143

Architecture Step **18** output: real family users, feedback, bug fixes.

## Goals

1. 2–3 real families use the app for 7–14 days.
2. Collect structured feedback (login, family invite, money entry, grocery, sync).
3. Fix P0/P1 bugs before production go-live (Step 19).

## Who to invite

| Role | Count | Devices |
|------|-------|---------|
| Owner (primary) | 1–2 | Web + optional Android |
| Responsible person / member | 2–4 | Web / phone |
| Read-only member (optional) | 1 | Web |

## Build under test

- Branch: `main` (or release tag)
- API: staging URL **or** local `http://127.0.0.1:8000` + Vite `http://127.0.0.1:5173`
- Mobile: custom native / EAS build (not Expo Go) if testing SQLCipher

## Test script (must run)

| # | Scenario | Pass criteria |
|---|----------|---------------|
| 1 | Register / login / refresh | Token works; logout clears session |
| 2 | Create family + invite code | Member joins with approval |
| 3 | Assign relationship + RBAC | Permission denied where expected |
| 4 | Add income/expense (double-entry) | Balances; journal lines = 2 |
| 5 | Budget overspend | Warning visible / notification row |
| 6 | Grocery list collab | Second user sees updates |
| 7 | Offline edit → online sync | Outbox flushes; no stuck conflicts |
| 8 | Loan installment | Payment reduces balance |
| 9 | Report PDF/Excel | Download opens |
| 10 | Zakat calculate | History row saved |
| 11 | Language BN/EN toggle | UI switches |
| 12 | Failed login rate limit | Lock / throttle after abuse |

## Feedback channels

1. GitHub Issue template: **Beta feedback** (`.github/ISSUE_TEMPLATE/beta-feedback.yml`)
2. Fill the form below and attach screenshots

### Feedback form (copy)

```
Family / tester name:
Date:
Device / browser:
Build / URL:

What worked:
What broke (steps):
Expected:
Actual:
Severity (P0 blocker / P1 high / P2 medium / P3 low):
Screenshots / video:
```

## Bug fix SLA (beta)

| Severity | Fix target |
|----------|------------|
| P0 | Same day / before next beta build |
| P1 | ≤ 3 days |
| P2 | Before production |
| P3 | Backlog |

## Exit criteria → Step 19

- [ ] Security audit report signed (`deploy/SECURITY_AUDIT_REPORT.md`)
- [ ] ≥ 2 families completed test script rows 1–11
- [ ] No open P0; P1 either fixed or accepted in writing
- [ ] Backup drill OK on staging/VPS package
- [ ] Operator checklist started (`deploy/OPERATOR_GO_LIVE.md`)
