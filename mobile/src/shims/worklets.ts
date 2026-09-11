/** Expo Go safe shim for react-native-worklets (avoids native SIGSEGV). */
export function scheduleOnRN<T extends (...args: any[]) => any>(fn: T): T {
  return fn;
}
export function runOnUI<T extends (...args: any[]) => any>(fn: T): T {
  return fn;
}
export function runOnJS<T extends (...args: any[]) => any>(fn: T): T {
  return fn;
}
export function getUIRuntimeHolder() {
  return null;
}
export function createSerializable() {
  return null;
}
export default {
  scheduleOnRN,
  runOnUI,
  runOnJS,
  getUIRuntimeHolder,
};
