module.exports = function (api) {
  api.cache(true);
  // When using Expo Go anim shims, skip worklets babel plugin (native runtime is stubbed).
  const useAnimShims = process.env.EXPO_USE_ANIM_SHIMS !== "0";
  return {
    presets: ["babel-preset-expo"],
    plugins: useAnimShims ? [] : ["react-native-worklets/plugin"],
  };
};
