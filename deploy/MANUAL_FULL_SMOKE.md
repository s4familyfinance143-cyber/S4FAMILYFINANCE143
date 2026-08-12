# Manual full smoke — S4 Family Finance (device)

Use native APK `com.s4familyfinance143.app` (preferred) or Expo Go.

## Preconditions
- [ ] API `http://127.0.0.1:8000/health` → 200
- [ ] `adb devices` shows phone `device`
- [ ] `adb reverse tcp:8000 tcp:8000` (and Metro reverse if Expo Go)
- [ ] App opens without crash

## Auth
- [ ] Login screen visible (`auth-email`, `auth-password`, `auth-sign-in`)
- [ ] Invalid login shows error
- [ ] Valid login reaches home/dashboard
- [ ] Logout returns to login (if available)

## Family
- [ ] Family list / active family loads
- [ ] Create or join family path works (or already joined)

## Finance
- [ ] Accounts / wallets list loads
- [ ] Categories load
- [ ] Transactions list loads
- [ ] Add income/expense (or offline enqueue) works without crash

## Grocery
- [ ] Grocery lists load
- [ ] Open list → items visible
- [ ] Toggle bought / add item works

## Sync / offline
- [ ] Airplane mode → local write OK
- [ ] Online → sync/pending counters update (or no crash)

## Security
- [ ] Native APK log shows SQLCipher / encrypted DB note (not Expo Go plain)
- [ ] App survives kill + reopen with session

## Languages / theme
- [ ] Switch language (bn/en) — labels change
- [ ] Theme toggle (if present) — no crash

## Reports / extras (if tabs present)
- [ ] Reports / cashflow opens
- [ ] Budgets / savings / loans tabs open without crash
- [ ] Settings / backup / sync screens open

## Pass criteria
All checked items pass without crash; API calls use `/api/v1/...` (no double `/api/v1/api/v1`).
