import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * API base URL. Set EXPO_PUBLIC_API_URL to your machine's LAN address when testing on a device
 * (e.g. http://192.168.1.20:4000). The Android emulator reaches the host at 10.0.2.2.
 */
function defaultUrl() {
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host) return `http://${host}:4000`;
  return Platform.OS === "android" ? "http://10.0.2.2:4000" : "http://localhost:4000";
}

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? defaultUrl();
