import * as Location from "expo-location";

/** Best-effort location stamp for clock-in/out. Never blocks a timer for more than ~3s. */
export async function currentGeo(): Promise<{ lat: number; lng: number; accuracyM?: number } | null> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status === "undetermined") perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
    const pos =
      last ??
      (await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((r) => setTimeout(() => r(null), 3000)),
      ]));
    if (!pos) return null;
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy ?? undefined };
  } catch {
    return null;
  }
}
