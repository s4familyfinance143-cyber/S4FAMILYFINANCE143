/**
 * Detox E2E scaffold — run on native builds (not Expo Go).
 * Install: npm i -D detox jest-circus
 * Then: detox build / detox test
 */
const gradleExecutable = process.platform === "win32" ? "gradlew.bat" : "./gradlew";

module.exports = {
  testRunner: "jest",
  runnerConfig: "e2e/config.json",
  specs: ["e2e"],
  apps: {
    "android.debug": {
      type: "android.apk",
      binaryPath: "android/app/build/outputs/apk/debug/app-debug.apk",
      build: `cd android && ${gradleExecutable} assembleDebug assembleAndroidTest -DtestBuildType=debug -PreactNativeArchitectures=arm64-v8a`,
    },
  },
  devices: {
    emulator: {
      type: "android.emulator",
      device: { avdName: process.env.DETOX_AVD || "S4_API36" },
    },
    attached: {
      type: "android.attached",
      device: { adbName: process.env.DETOX_ADB_NAME || "d2743cea7d76" },
    },
  },
  configurations: {
    "android.emu.debug": {
      device: "emulator",
      app: "android.debug",
    },
    "android.att.debug": {
      device: "attached",
      app: "android.debug",
      behavior: {
        init: {
          reinstallApp: false,
          exposeGlobals: true,
        },
      },
    },
  },
};
