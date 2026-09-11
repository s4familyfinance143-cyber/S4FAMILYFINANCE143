/**
 * Expo Go safe shim — avoids libworklets.so SIGSEGV on some Android devices.
 * Real reanimated is used in native/dev builds (set EXPO_USE_ANIM_SHIMS=0).
 */
import React from "react";
import { Animated, Easing as RNEasing, Image, Text, View } from "react-native";

type AnyProps = Record<string, unknown> & { children?: React.ReactNode; entering?: unknown; exiting?: unknown; style?: unknown };

function stripEntering(props: AnyProps) {
  const { entering: _e, exiting: _x, ...rest } = props;
  return rest;
}

const AnimatedView = Animated.createAnimatedComponent(View);
const AnimatedText = Animated.createAnimatedComponent(Text);
const AnimatedImage = Animated.createAnimatedComponent(Image);

function makeAnim(Comp: React.ComponentType<any>) {
  return React.forwardRef((props: AnyProps, ref) => React.createElement(Comp, { ...stripEntering(props), ref }));
}

const Reanimated = {
  View: makeAnim(AnimatedView),
  Text: makeAnim(AnimatedText),
  Image: makeAnim(AnimatedImage),
  ScrollView: makeAnim(Animated.ScrollView),
  FlatList: makeAnim(Animated.FlatList),
  createAnimatedComponent: Animated.createAnimatedComponent,
  call: () => undefined,
  addWhitelistedNativeProps: () => undefined,
  addWhitelistedUIProps: () => undefined,
};

export default Reanimated;
export const Easing = RNEasing;
export class Keyframe {
  duration() {
    return this;
  }
}
export const FadeIn = { duration: () => ({}) };
export const FadeOut = { duration: () => ({}) };
export const LinearTransition = { duration: () => ({}) };
export function useSharedValue<T>(value: T) {
  return { value };
}
export function useAnimatedStyle(fn: () => object) {
  try {
    return fn();
  } catch {
    return {};
  }
}
export function withTiming<T>(value: T) {
  return value;
}
export function withSpring<T>(value: T) {
  return value;
}
export function runOnJS<T extends (...args: any[]) => any>(fn: T) {
  return fn;
}
export function runOnUI<T extends (...args: any[]) => any>(fn: T) {
  return fn;
}
export function scheduleOnRN<T extends (...args: any[]) => any>(fn: T) {
  return fn;
}
