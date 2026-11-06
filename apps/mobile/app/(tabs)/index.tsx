import { formatMinutes } from "@timepeace/shared";
import { Link, router } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { Elapsed } from "@/components/Elapsed";
import { SyncBanner } from "@/components/SyncBanner";
import { Button, Card, StatusPill, colors, s } from "@/components/ui";
import { sqliteOutbox } from "@/lib/db";
import { useField, type DayTask } from "@/lib/field";
import { useSession } from "@/lib/session";

export default function Today() {
  const { day, dayLoading, timer, start, stop, refresh } = useField();
  const { session, signOut } = useSession();
  const [refreshing, setRefreshing] = useState(false);
  const running = timer && day?.tasks.find((t) => t.id === timer.taskId);
  const paidToday = day?.paidMinutesToday ?? 0;
  const byProject = useMemo(() => {
    const m = new Map<string, { id: string; name: string; address: string | null; tasks: DayTask[] }>();
    for (const t of day?.tasks ?? []) {
      const g = m.get(t.project.id) ?? { id: t.project.id, name: t.project.name, address: t.project.address, tasks: [] };
      g.tasks.push(t);
      m.set(t.project.id, g);
    }
    return [...m.values()];
  }, [day]);

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await refresh().catch(() => {});
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={[s.row, { justifyContent: "space-between" }]}>
        <View>
          <Text style={s.h1}>Hi {session?.user.name.split(" ")[0]}</Text>
          <Text style={s.muted}>
            {day?.date ?? ""} · {formatMinutes(paidToday)} on the clock today
          </Text>
        </View>
        <Pressable onPress={signOutWithCheck(signOut)} accessibilityRole="button">
          <Text style={s.muted}>Sign out</Text>
        </Pressable>
      </View>

      <SyncBanner />

      <ClockCard projects={byProject.map((g) => ({ id: g.id, name: g.name }))} runningTitle={running?.title ?? null} />

      {dayLoading && <Text style={s.muted}>Loading your tasks…</Text>}
      {!dayLoading && !day && <Text style={s.muted}>Connect to the internet once to download your assigned tasks.</Text>}
      {day && day.tasks.length === 0 && <Text style={s.muted}>No tasks assigned to you today. Check with your manager.</Text>}

      {byProject.map((g) => (
        <View key={g.name} style={{ gap: 8 }}>
          <View>
            <Text style={s.h2}>{g.name}</Text>
            {g.address && <Text style={s.muted}>{g.address}</Text>}
          </View>
          {g.tasks.map((t) => {
            const isRunning = timer?.taskId === t.id;
            const finished = t.status === "DONE" || t.status === "VERIFIED";
            return (
              <Link key={t.id} href={{ pathname: "/task/[id]", params: { id: t.id } }} asChild>
                <Pressable>
                  <Card style={isRunning ? { borderColor: colors.brand, borderWidth: 2 } : undefined}>
                    <View style={[s.row, { justifyContent: "space-between", alignItems: "flex-start" }]}>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={[s.body, { fontWeight: "600" }, finished && { color: colors.muted, textDecorationLine: "line-through" }]}>{t.title}</Text>
                        <Text style={s.muted}>{t.phase?.name}</Text>
                        <StatusPill status={t.status} />
                        {t.statusNote && <Text style={[s.muted, { color: colors.warning }]}>{t.statusNote}</Text>}
                      </View>
                      {!finished && !isRunning && (
                        <Button title={timer ? "Switch" : "Start"} onPress={() => start(t)} style={{ minWidth: 84 }} />
                      )}
                      {isRunning && <Button title="Stop" variant="danger" onPress={() => stop()} style={{ minWidth: 84 }} />}
                    </View>
                  </Card>
                </Pressable>
              </Link>
            );
          })}
        </View>
      ))}

      <Button title="+ Add expense / receipt" variant="secondary" onPress={() => router.push("/expense/new")} />
    </ScrollView>
  );
}

/** Clock in/out is what you're paid for. Task timers just record what you worked on. */
function ClockCard({ projects, runningTitle }: { projects: { id: string; name: string }[]; runningTitle: string | null }) {
  const { field, clockIn, clockOut, startBreak, endBreak, stop } = useField();
  const shift = field.shift;

  if (!shift) {
    const doClockIn = () => {
      if (projects.length <= 1) return clockIn(projects[0]?.id ?? null);
      Alert.alert("Clock in at which job?", undefined, [
        ...projects.map((p) => ({ text: p.name, onPress: () => void clockIn(p.id) })),
        { text: "Shop / no specific job", onPress: () => void clockIn(null) },
        { text: "Cancel", style: "cancel" as const },
      ]);
    };
    return (
      <Card>
        <Text style={s.h2}>Off the clock</Text>
        <Text style={s.muted}>Clock in when you start work. You're paid for all time on the clock, including setup, travel and cleanup between tasks.</Text>
        <Button big title="Clock in" variant="success" onPress={doClockIn} />
      </Card>
    );
  }

  const onBreak = shift.onBreak;
  return (
    <Card style={{ backgroundColor: onBreak ? colors.warningBg : colors.brand, borderColor: onBreak ? colors.warning : colors.brand }}>
      <Text style={{ color: onBreak ? colors.warning : "#dbeafe", fontSize: 13, fontWeight: "600" }}>
        {onBreak ? "ON MEAL BREAK" : "ON THE CLOCK"} · since {new Date(shift.clockedInAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </Text>
      <Elapsed since={onBreak ? onBreak.startedAt : shift.clockedInAt} style={{ color: onBreak ? colors.warning : "#fff", fontSize: 40, fontWeight: "700" }} />
      {field.task ? (
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#dbeafe", fontSize: 12 }}>WORKING ON</Text>
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
              {runningTitle ?? "Task"}
            </Text>
            <Elapsed since={field.task.startedAt} style={{ color: "#dbeafe" }} />
          </View>
          <Button title="Stop task" variant="secondary" onPress={() => stop()} />
        </View>
      ) : (
        !onBreak && <Text style={{ color: "#dbeafe" }}>Not on a task right now (still paid). Pick a task below to track it.</Text>
      )}
      <View style={s.row}>
        <Button title={onBreak ? "End break" : "Meal break"} variant="secondary" onPress={() => (onBreak ? endBreak() : startBreak())} style={{ flex: 1 }} />
        <Button
          title="Clock out"
          variant="danger"
          style={{ flex: 1 }}
          onPress={() =>
            Alert.alert("Clock out?", "This ends your shift" + (field.task ? " and stops your task timer." : "."), [
              { text: "Cancel", style: "cancel" },
              { text: "Clock out", style: "destructive", onPress: () => void clockOut() },
            ])
          }
        />
      </View>
    </Card>
  );
}

function signOutWithCheck(signOut: () => Promise<void>) {
  return async () => {
    // Warn before discarding unsynced work.
    const c = await sqliteOutbox.count();
    if (c.pending > 0) {
      Alert.alert("Unsynced changes", `${c.pending} change(s) haven't uploaded yet. Signing out will discard them.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out anyway", style: "destructive", onPress: () => signOut() },
      ]);
    } else await signOut();
  };
}
