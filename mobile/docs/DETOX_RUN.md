# Detox E2E on Windows

Run these commands in PowerShell from a machine with Node.js, Java, and the
Android SDK installed.

## Install and select an emulator

```powershell
Set-Location 'S:\S4-FAMILY-FINANCE-143-FINAL\mobile'
npm ci

# Optional: the config defaults to S4_API36.
# Override this with the exact name shown by: emulator -list-avds
$env:DETOX_AVD = 'S4_API36'
```

If the available AVD is named `Pixel_6_API_34`, use this override instead:

```powershell
$env:DETOX_AVD = 'Pixel_6_API_34'
```

## Build

```powershell
Set-Location 'S:\S4-FAMILY-FINANCE-143-FINAL\mobile'
npm run test:e2e:build
```

The Detox config automatically uses `android\gradlew.bat` on Windows.

## Start the AVD

In a separate PowerShell window:

```powershell
$env:DETOX_AVD = 'S4_API36'
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd $env:DETOX_AVD
```

Use the same `DETOX_AVD` value for the build/test window and the emulator
window. Detox can also start the configured AVD itself, so manually starting
it is optional.

## Run

```powershell
Set-Location 'S:\S4-FAMILY-FINANCE-143-FINAL\mobile'
$env:DETOX_AVD = 'S4_API36'
npm run test:e2e
```

To reuse an already-running app/emulator during local iteration:

```powershell
npm run test:e2e -- --reuse
```

## Run on USB phone (when emulator stays offline)

```powershell
Set-Location 'S:\S4-FAMILY-FINANCE-143-FINAL\mobile'
# After a debug APK exists:
$env:DETOX_ADB_NAME = 'd2743cea7d76'   # adb devices
npm run test:e2e:build
npm run test:e2e:device
```

Detox config: `android.att.debug` in `.detoxrc.js`.

