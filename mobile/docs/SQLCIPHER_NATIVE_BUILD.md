# SQLCipher native build (Expo)

Expo Go **cannot** ship full SQLCipher. The app already:

- Sets `expo-sqlite` plugin `useSQLCipher: true` in `app.json`
- Stores a DB key in SecureStore (`mobileDbCrypto`)
- Runs `PRAGMA key` on open (`mobile/src/lib/mobileDb.ts`)
- Falls back status `sqlcipher_pending_custom_build` until `PRAGMA cipher_version` works

## Build a custom native binary

Requirements: Android Studio **or** Xcode, Node 20+, Expo CLI, JDK 17+.

### Windows PATH (common fix)

`adb` often exists under `%LOCALAPPDATA%\Android\Sdk\platform-tools` but is **not** on PATH. In PowerShell:

```powershell
cd mobile
.\scripts\setup-android-env.ps1
# or
npm run env:android
```

Confirm: `adb version` and `echo $env:ANDROID_HOME`.

```bash
cd mobile
npm install
npm run prebuild:native
npm run android:native
# or APK only (no device/emulator required):
npm run android:apk
# APK path: android/app/build/outputs/apk/debug/app-debug.apk
# or
npm run ios:native
```

After prebuild, `android/gradle.properties` must contain `expo.sqlite.useSQLCipher=true`.

### Windows path-length fix (required on many PCs)

If CMake/ninja fails with `Filename longer than 260 characters` (often under Cursor sandbox Gradle caches), use a short Gradle home **for the session**:

```powershell
mkdir C:\g -Force
$env:GRADLE_USER_HOME = "C:\g"
.\scripts\setup-android-env.ps1
npm run android:apk:emu   # x86_64 emulator APK
# or full ABIs:
npm run android:apk
```

`setup-android-env.ps1` sets `GRADLE_USER_HOME=C:\g` automatically when the current value points at a sandbox cache.

## How to verify SQLCipher is active

1. Open the app Sync / Control Center status pills.
2. Expect **SQLCipher ON** (not “Cipher key ready”).
3. Or log `getOfflineDbSecurityStatus()` → `mode: "sqlcipher"` and a non-null `cipherVersion`.

## Web preview

Web uses AES-GCM payload encryption (`mobileDb.web.ts`) — not SQLCipher. That is expected.

## EAS development client (recommended)

```bash
npm run eas:build:dev
```

Install the resulting APK/IPA (not Expo Go). Then confirm Sync tab shows **SQLCipher ON**.
