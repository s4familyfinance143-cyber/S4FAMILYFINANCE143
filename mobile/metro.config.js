const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Default ON for Expo Go stability on devices that SIGSEGV in libworklets.so.
// Native builds: set EXPO_USE_ANIM_SHIMS=0
const useAnimShims = process.env.EXPO_USE_ANIM_SHIMS !== "0";

const emptyNative = new Set(["react-native-mmkv", "react-native-nitro-modules"]);

const shimMap = useAnimShims
  ? {
      "react-native-reanimated": path.resolve(__dirname, "src/shims/reanimated.tsx"),
      "react-native-worklets": path.resolve(__dirname, "src/shims/worklets.ts"),
    }
  : {};

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (emptyNative.has(moduleName)) {
    return { type: "empty" };
  }
  if (shimMap[moduleName]) {
    return {
      filePath: shimMap[moduleName],
      type: "sourceFile",
    };
  }
  if (typeof upstreamResolveRequest === "function") {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
