import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorMessage, useTRPC } from "@timepeace/api-client";
import { formatMinutes, toLocalDate } from "@timepeace/shared";
import { useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { SyncBanner } from "@/components/SyncBanner";
import { Button, Card, StatusPill, colors, s } from "@/components/ui";
import { useField } from "@/lib/field";

export default function Timesheet() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { field, sync, syncNow, day: myDay } = useField();
  const clockedIn = !!field.shift;
  const tz = myDay?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [offset, setOffset] = useState(0);
  const q = useQuery(trpc.field.myPeriod.queryOptions({ offset }));
  const submit = useMutation(trpc.field.submitTimesheet.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: trpc.field.myPeriod.queryKey() }) }));
  const d = q.data;
  const canSubmit = d && (!d.timesheet || d.timesheet.status === "DRAFT" || d.timesheet.status === "REJECTED") && d.shifts.length > 0;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => void q.refetch()} />}>
      <SyncBanner />
      <View style={[s.row, { justifyContent: "space-between" }]}>
        <Button title="‹ Prev" variant="secondary" onPress={() => setOffset(offset - 1)} />
        <Text style={s.h2}>{d ? `${d.period.start.slice(5)} – ${d.period.end.slice(5)}` : "…"}</Text>
        <Button title="Next ›" variant="secondary" disabled={offset === 0} onPress={() => setOffset(Math.min(0, offset + 1))} />
      </View>
      {q.error && <Text style={{ color: colors.critical }}>{errorMessage(q.error)}</Text>}
      {d && (
        <>
          <Card>
            <View style={[s.row, { justifyContent: "space-between" }]}>
              <Text style={[s.h1, s.tabular]}>{formatMinutes(d.totals.totalMinutes)}</Text>
              <StatusPill status={d.timesheet?.status ?? "DRAFT"} />
            </View>
            <Text style={[s.muted, s.tabular]}>Paid time from your clock in/out. {formatMinutes(d.allocatedMinutes)} of it was tracked on tasks.</Text>
            <Text style={[s.muted, s.tabular]}>
              Regular {formatMinutes(d.totals.regularMinutes)} · Overtime {formatMinutes(d.totals.overtimeMinutes)}
              {d.totals.doubleTimeMinutes ? ` · Double ${formatMinutes(d.totals.doubleTimeMinutes)}` : ""}
            </Text>
            {d.timesheet?.status === "REJECTED" && d.timesheet.reviewNote && <Text style={{ color: colors.critical }}>Manager note: {d.timesheet.reviewNote}</Text>}
            {canSubmit && (
              <Button
                big
                title="Submit hours for approval"
                loading={submit.isPending}
                onPress={async () => {
                  if (clockedIn) return Alert.alert("Still clocked in", "Clock out before submitting your timesheet.");
                  if (sync.pending) await syncNow();
                  Alert.alert("Submit timesheet?", `${formatMinutes(d.totals.totalMinutes)} for ${d.period.start} – ${d.period.end}. You can't change it after your manager approves it.`, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Submit", onPress: () => submit.mutateAsync({ payPeriodId: d.period.id }).catch((e) => Alert.alert("Couldn't submit", errorMessage(e))) },
                  ]);
                }}
              />
            )}
          </Card>
          {d.totals.days.map((day) => (
            <Card key={day.date}>
              <View style={[s.row, { justifyContent: "space-between" }]}>
                <Text style={s.h2}>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</Text>
                <Text style={[s.body, s.tabular, { fontWeight: "600" }]}>{formatMinutes(day.workedMinutes)}</Text>
              </View>
              {d.shifts
                .filter((sh) => toLocalDate(sh.clockInAt, tz) === day.date)
                .map((sh) => (
                  <View key={sh.id} style={{ gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 }}>
                    <Text style={[s.body, s.tabular]}>
                      {fmtTime(sh.clockInAt)} – {sh.clockOutAt ? fmtTime(sh.clockOutAt) : "now"} · paid {formatMinutes(sh.paidMinutes)}
                    </Text>
                    {sh.flag === "AUTO_CLOSED" && <Text style={{ color: colors.critical }}>No clock-out was recorded. Tell your manager what time you actually finished.</Text>}
                    {sh.breaks.map((b) => (
                      <Text key={b.id} style={s.muted}>
                        Break {fmtTime(b.startedAt)} – {b.endedAt ? fmtTime(b.endedAt) : "now"}
                      </Text>
                    ))}
                    {sh.entries.map((e) => (
                      <Text key={e.id} style={s.muted} numberOfLines={1}>
                        • {e.taskTitle ?? e.projectName} · {formatMinutes(e.minutes)}
                      </Text>
                    ))}
                    {sh.unallocatedMinutes > 0 && <Text style={s.muted}>• Not on a task (setup, travel, cleanup) · {formatMinutes(sh.unallocatedMinutes)}, paid</Text>}
                  </View>
                ))}
            </Card>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
