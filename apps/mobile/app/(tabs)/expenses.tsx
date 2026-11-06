import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@timepeace/api-client";
import { formatCents } from "@timepeace/shared";
import { router } from "expo-router";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { SyncBanner } from "@/components/SyncBanner";
import { Button, Card, StatusPill, useStyles } from "@/components/ui";

export default function Expenses() {
  const s = useStyles();
  const trpc = useTRPC();
  const q = useQuery(trpc.field.myExpenses.queryOptions());
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => void q.refetch()} />}>
      <SyncBanner />
      <Button big title="+ Add expense / receipt" onPress={() => router.push("/expense/new")} />
      {q.data?.length === 0 && <Text style={s.muted}>No expenses yet.</Text>}
      {q.data?.map((e) => (
        <Card key={e.id}>
          <View style={[s.row, { justifyContent: "space-between" }]}>
            <Text style={[s.body, { fontWeight: "600", flex: 1 }]}>{e.vendorName}</Text>
            <Text style={[s.body, s.tabular, { fontWeight: "600" }]}>{formatCents(e.amountCents)}</Text>
          </View>
          <Text style={s.muted}>
            {e.spentOn.toISOString().slice(0, 10)} · {e.project?.name ?? "Company"}
            {e.note ? ` · ${e.note}` : ""}
          </Text>
          <View style={s.row}>
            <StatusPill status={e.status} />
            {e.paidBy === "PERSONAL" && <Text style={s.muted}>reimbursable</Text>}
            {e.receiptFileId && <Text style={s.muted}>🧾 receipt</Text>}
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
