import { Alert, Pressable, Text, View } from "react-native";
import { useField } from "@/lib/field";
import { colors, s } from "./ui";

/** Shows unsynced changes and any actions the server rejected. */
export function SyncBanner() {
  const { sync, syncNow, dismissRejected } = useField();
  if (!sync.pending && !sync.rejected.length) return null;
  return (
    <View style={{ gap: 6 }}>
      {sync.pending > 0 && (
        <Pressable onPress={syncNow} style={[s.card, { backgroundColor: sync.offline ? colors.warningBg : colors.brandLight, paddingVertical: 10 }]}>
          <Text style={[s.body, { color: sync.offline ? colors.warning : colors.brandDark }]}>
            {sync.syncing ? "Syncing…" : sync.offline ? `Offline: ${sync.pending} change(s) saved on this phone. They'll upload when you're back online.` : `${sync.pending} change(s) waiting to upload. Tap to retry.`}
          </Text>
        </Pressable>
      )}
      {sync.rejected.map((r) => (
        <Pressable
          key={r.seq}
          onPress={() => Alert.alert("Not saved", `${describe(r.op.type)} was not accepted: ${r.error}`, [{ text: "Dismiss", onPress: () => dismissRejected(r.seq) }, { text: "Keep" }])}
          style={[s.card, { backgroundColor: colors.criticalBg, paddingVertical: 10 }]}
        >
          <Text style={[s.body, { color: colors.critical }]}>
            ⚠︎ {describe(r.op.type)} wasn&apos;t accepted: {r.error}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function describe(type: string) {
  return (
    { "time.start": "Starting a timer", "time.stop": "Stopping a timer", "task.status": "A task update", "material.request": "A material request", "expense.create": "An expense" }[type] ?? "A change"
  );
}
