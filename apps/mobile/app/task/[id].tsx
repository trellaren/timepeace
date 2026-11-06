import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { Elapsed } from "@/components/Elapsed";
import { Button, Card, Field, StatusPill, colors, s } from "@/components/ui";
import { useField } from "@/lib/field";

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { day, timer, start, stop, setStatus, requestMaterials } = useField();
  const task = day?.tasks.find((t) => t.id === id);
  const [mode, setMode] = useState<null | "materials" | "blocked">(null);
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("");
  if (!task) return <Text style={[s.muted, { padding: 16 }]}>Task not found.</Text>;
  const isRunning = timer?.taskId === task.id;
  const finished = task.status === "DONE" || task.status === "VERIFIED";

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: task.project.name }} />
      <Card>
        <Text style={s.h1}>{task.title}</Text>
        <Text style={s.muted}>
          {task.project.name}
          {task.phase ? ` · ${task.phase.name}` : ""}
        </Text>
        <StatusPill status={task.status} />
        {task.description && <Text style={s.body}>{task.description}</Text>}
        {task.estimatedMinutes != null && <Text style={s.muted}>Estimated: {Math.round(task.estimatedMinutes / 60)} hrs</Text>}
        {task.statusNote && <Text style={{ color: colors.warning }}>{task.statusNote}</Text>}
        {task.materialRequests.map((m) => (
          <Text key={m.id} style={s.muted}>
            Requested: {m.quantity ? `${m.quantity} × ` : ""}
            {m.description} ({m.status.toLowerCase()})
          </Text>
        ))}
      </Card>

      {isRunning ? (
        <Card style={{ alignItems: "center" }}>
          <Elapsed since={timer.startedAt} style={{ fontSize: 44, fontWeight: "700", color: colors.brand }} />
          <Button big title="Stop timer" variant="danger" onPress={() => stop()} style={{ alignSelf: "stretch" }} />
        </Card>
      ) : (
        !finished && <Button big title={timer ? "Switch to this task" : "Start timer"} onPress={() => start(task)} />
      )}

      {!finished && (
        <View style={{ gap: 8 }}>
          <Button
            title="✓ Mark done"
            variant="success"
            onPress={() =>
              Alert.alert("Mark done?", "Your manager will be able to verify it.", [
                { text: "Cancel", style: "cancel" },
                { text: "Done", onPress: () => setStatus(task, "DONE").then(() => router.back()) },
              ])
            }
          />
          <Button title="Needs parts / materials" variant="secondary" onPress={() => setMode(mode === "materials" ? null : "materials")} />
          <Button title="Blocked / can't continue" variant="secondary" onPress={() => setMode(mode === "blocked" ? null : "blocked")} />
        </View>
      )}
      {finished && task.status === "DONE" && <Button title="Reopen task" variant="secondary" onPress={() => setStatus(task, "IN_PROGRESS")} />}

      {mode === "materials" && (
        <Card>
          <Text style={s.h2}>What do you need?</Text>
          <Field label="Item" value={desc} onChangeText={setDesc} placeholder={'e.g. 2x4x8 studs, 3" deck screws'} />
          <Field label="Quantity" value={qty} onChangeText={setQty} placeholder="e.g. 40" />
          <Button
            title="Send request to manager"
            disabled={!desc}
            onPress={async () => {
              await requestMaterials(task, desc, qty);
              setMode(null);
              setDesc("");
              setQty("");
            }}
          />
        </Card>
      )}
      {mode === "blocked" && (
        <Card>
          <Text style={s.h2}>What&apos;s blocking you?</Text>
          <Field label="Reason" value={desc} onChangeText={setDesc} multiline placeholder="e.g. Waiting on inspection, rain, prior trade not finished" />
          <Button
            title="Flag as blocked"
            variant="danger"
            disabled={!desc}
            onPress={async () => {
              await setStatus(task, "BLOCKED", desc);
              setMode(null);
              setDesc("");
            }}
          />
        </Card>
      )}

      <Button title="+ Add expense for this task" variant="secondary" onPress={() => router.push({ pathname: "/expense/new", params: { projectId: task.project.id, taskId: task.id } })} />
    </ScrollView>
  );
}
