import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@timepeace/api-client";
import { dollarsToCents, toLocalDate, type CostCategory } from "@timepeace/shared";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Image, Pressable, ScrollView, Text, View } from "react-native";
import { Button, Card, Field, Segmented, colors, s } from "@/components/ui";
import { useField } from "@/lib/field";
import { kv } from "@/lib/db";
import { useEffect } from "react";

type Target = { id: string; name: string; tasks: { id: string; title: string }[] };

export default function NewExpense() {
  const params = useLocalSearchParams<{ projectId?: string; taskId?: string }>();
  const trpc = useTRPC();
  const { addExpense, day } = useField();
  const targetsQuery = useQuery(trpc.field.expenseTargets.queryOptions());
  const [cachedTargets, setCachedTargets] = useState<Target[] | null>(null);
  useEffect(() => {
    if (targetsQuery.data) kv.set("expenseTargets", targetsQuery.data);
    else kv.get<Target[]>("expenseTargets").then(setCachedTargets);
  }, [targetsQuery.data]);
  const targets = targetsQuery.data ?? cachedTargets ?? [];

  const [projectId, setProjectId] = useState(params.projectId ?? "");
  const [taskId, setTaskId] = useState(params.taskId ?? "");
  const [vendor, setVendor] = useState("");
  const [total, setTotal] = useState("");
  const [tax, setTax] = useState("");
  const [category, setCategory] = useState<CostCategory>("MATERIAL");
  const [paidBy, setPaidBy] = useState<"COMPANY" | "PERSONAL">("PERSONAL");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const project = targets.find((p) => p.id === projectId) ?? (targets.length === 1 ? targets[0] : undefined);

  const takePhoto = async (fromLibrary: boolean) => {
    if (!fromLibrary) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert("Camera permission needed", "Allow camera access to photograph receipts.");
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.6 };
    const r = fromLibrary ? await ImagePicker.launchImageLibraryAsync(opts) : await ImagePicker.launchCameraAsync(opts);
    if (!r.canceled && r.assets[0]) setPhoto(r.assets[0].uri);
  };

  const save = async () => {
    let amountCents: number;
    let taxCents = 0;
    try {
      amountCents = dollarsToCents(total);
      if (tax) taxCents = dollarsToCents(tax);
    } catch {
      return Alert.alert("Check the amount", "Enter amounts like 34.97");
    }
    if (!project) return Alert.alert("Pick a project");
    if (!vendor.trim()) return Alert.alert("Where did you buy it?", "Enter the store or vendor name.");
    if (amountCents <= 0) return Alert.alert("Enter the receipt total");
    setSaving(true);
    try {
      await addExpense(
        {
          projectId: project.id,
          taskId: taskId || null,
          vendorName: vendor.trim(),
          amountCents,
          salesTaxCents: taxCents,
          category,
          paidBy,
          note: note || null,
          receiptFileId: null,
          spentOn: toLocalDate(new Date(), day?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone),
        },
        photo,
      );
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={s.label}>Receipt photo</Text>
        {photo ? (
          <Pressable onPress={() => setPhoto(null)}>
            <Image source={{ uri: photo }} style={{ width: "100%", height: 220, borderRadius: 8 }} resizeMode="cover" />
            <Text style={[s.muted, { textAlign: "center", marginTop: 4 }]}>Tap to remove</Text>
          </Pressable>
        ) : (
          <View style={s.row}>
            <Button title="📷 Take photo" onPress={() => takePhoto(false)} style={{ flex: 1 }} />
            <Button title="Choose" variant="secondary" onPress={() => takePhoto(true)} />
          </View>
        )}
      </Card>

      <Card>
        <Text style={s.label}>Project</Text>
        {targets.length === 0 && <Text style={s.muted}>No assigned projects available offline yet.</Text>}
        {targets.map((p) => (
          <Pressable key={p.id} onPress={() => { setProjectId(p.id); setTaskId(""); }} style={[s.input, project?.id === p.id && { borderColor: colors.brand, backgroundColor: colors.brandLight }]}>
            <Text style={s.body}>{p.name}</Text>
          </Pressable>
        ))}
        {project && project.tasks.length > 0 && (
          <>
            <Text style={[s.label, { marginTop: 6 }]}>Task (optional)</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {project.tasks.map((t) => (
                <Pressable key={t.id} onPress={() => setTaskId(taskId === t.id ? "" : t.id)} style={[s.pill, { borderWidth: 1, borderColor: taskId === t.id ? colors.brand : colors.border, backgroundColor: taskId === t.id ? colors.brandLight : "#fff", paddingVertical: 6, paddingHorizontal: 10 }]}>
                  <Text style={{ color: colors.text }}>{t.title}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </Card>

      <Card>
        <Field label="Store / vendor" value={vendor} onChangeText={setVendor} placeholder="Home Depot" />
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Field label="Total ($)" value={total} onChangeText={setTotal} keyboardType="decimal-pad" placeholder="34.97" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Of which tax ($)" value={tax} onChangeText={setTax} keyboardType="decimal-pad" placeholder="optional" />
          </View>
        </View>
        <Text style={s.label}>What is it?</Text>
        <Segmented<CostCategory>
          value={category}
          onChange={setCategory}
          options={[
            { value: "MATERIAL", label: "Materials" },
            { value: "OTHER", label: "Tools/supplies" },
            { value: "EQUIPMENT", label: "Rental" },
          ]}
        />
        <Text style={s.label}>Paid with</Text>
        <Segmented
          value={paidBy}
          onChange={setPaidBy}
          options={[
            { value: "PERSONAL", label: "My own money" },
            { value: "COMPANY", label: "Company card" },
          ]}
        />
        {paidBy === "PERSONAL" && <Text style={s.muted}>Once approved, you'll be reimbursed on your next paycheck.</Text>}
        <Field label="Note" value={note} onChangeText={setNote} placeholder="e.g. Replacement drill bits" />
      </Card>

      <Button big title="Save expense" loading={saving} onPress={save} />
    </ScrollView>
  );
}
