# Expo Go — run S4 Family Finance without a custom native build

SQLCipher is **off** in Expo Go (plain SQLite, DB name `go_v4`). Full encryption needs the native APK (`cipher_version` proof).

## Preferred: USB + adb reverse (firewall-safe)

```powershell
cd s:\S4-FAMILY-FINANCE-143-FINAL\mobile
# Sets heap, polling, API origin, and tries adb reverse automatically
npm run start:go
```

Then on phone open: `exp://127.0.0.1:8082`

```powershell
# If reverse failed (no device yet):
adb reverse tcp:8082 tcp:8082
adb reverse tcp:8000 tcp:8000
```

API base is **origin only** (`http://127.0.0.1:8000`). Paths already include `/api/v1` — do not append `/api/v1` again.

## 1) Start API (PC)

```powershell
cd s:\S4-FAMILY-FINANCE-143-FINAL\backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Check: http://127.0.0.1:8000/health or `/api/v1/health`

## 2) Wi‑Fi alternate (if USB unavailable)

Edit `mobile/.env`:

```
EXPO_PUBLIC_API_BASE_URL=http://YOUR_PC_WIFI_IP:8000
```

Find IP: `ipconfig` → Wi-Fi IPv4 (not `127.0.0.1`, not VirtualBox/WSL).

## 3) Start Expo Go (manual)

```powershell
cd s:\S4-FAMILY-FINANCE-143-FINAL\mobile
npm install
$env:EXPO_PUBLIC_API_BASE_URL='http://127.0.0.1:8000'
$env:NODE_OPTIONS='--max-old-space-size=8192'
npm run start:go
```

`start:go` sets router check disable, telemetry off, CHOKIDAR polling, 8GB heap, port **8082**.

Scan the QR code with **Expo Go**. PC and phone must be on the same Wi-Fi.

### USB (recommended on this PC — Wi‑Fi to PC ports is often blocked)

```powershell
# Terminal A — API
cd s:\S4-FAMILY-FINANCE-143-FINAL\backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal B — Metro (must use --lan so Windows accepts IPv4; hostname=127.0.0.1 for reverse)
cd s:\S4-FAMILY-FINANCE-143-FINAL\mobile
npm run start:go

# Terminal C — USB bridge + open
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb -s YOUR_DEVICE_ID reverse tcp:8082 tcp:8082
& $adb -s YOUR_DEVICE_ID reverse tcp:8000 tcp:8000
& $adb -s YOUR_DEVICE_ID shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8082"
```

**Do not use** `exp://192.168.x.x` unless Windows Firewall allows inbound 8082/8000 (needs Admin).

**Do not use** `expo start --localhost` on Windows — Metro binds `::1` only and USB reverse (IPv4) fails.

Phone API base: `http://127.0.0.1:8000` while reverse is active.

**If Expo Go shows a red error:** often a Metro bundle failure. Do **not** `require("./icons/foo@2x.png")` — only `require("./icons/foo.png")`.

**If Xiaomi blocks APK install (`INSTALL_FAILED_USER_RESTRICTED`):** Developer options → enable **Install via USB**, then install again.

**If WhatsApp/Ezviz steals the screen:** swipe them away; Expo may already be loaded in recents.

Metro: http://127.0.0.1:8082


## What works in Expo Go

- Login / family / finance / grocery (camera barcode via expo-camera)
- Offline SQLite (plain) + sync when online
- 5 languages
- MMKV falls back to SecureStore
- More menu via `MobileMoreDrawerList` (no React Navigation drawer)

## What needs a native build (not Expo Go)

- SQLCipher encrypted DB
- ML Kit native OCR/barcode engine (expo-camera still works)
- Detox E2E
- react-native-mmkv speed path
