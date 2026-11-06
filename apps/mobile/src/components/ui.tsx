import type { Palette } from "@timepeace/shared";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { makeStyles, useColors } from "@/lib/theme";

export { useColors } from "@/lib/theme";

export function Button({ title, onPress, variant = "primary", disabled, loading, style, big }: { title: string; onPress: () => void; variant?: "primary" | "secondary" | "danger" | "success"; disabled?: boolean; loading?: boolean; style?: ViewStyle; big?: boolean }) {
  const c = useColors();
  const s = useStyles();
  const bg = { primary: c.accent, secondary: c.surface, danger: c.critical, success: c.goodStrong }[variant];
  const fg = variant === "secondary" ? c.ink : c.onAccent;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [s.btn, big && s.btnBig, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, variant === "secondary" && s.btnSecondary, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, big && s.btnTextBig, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const s = useStyles();
  return <View style={[s.card, style]}>{children}</View>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const c = useColors();
  const s = useStyles();
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={c.faint} {...props} style={[s.input, props.multiline && { minHeight: 72, textAlignVertical: "top" }]} />
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const c = useColors();
  const s = useStyles();
  return (
    <View style={s.seg}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.segItem, value === o.value && s.segActive]} accessibilityRole="button" accessibilityState={{ selected: value === o.value }}>
          <Text style={[s.segText, value === o.value && { color: c.onAccent }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function statusStyle(c: Palette, status: string): { label: string; color: string; bg: string } {
  const neutral = { color: c.ink2, bg: c.surface3 };
  const info = { color: c.accentInk, bg: c.accentSoft };
  const good = { color: c.goodInk, bg: c.goodSoft };
  const good2 = { color: c.goodInk, bg: c.goodSoft2 };
  const warn = { color: c.warningInk, bg: c.warningSoft };
  const bad = { color: c.criticalInk, bg: c.criticalSoft };
  const map: Record<string, { label: string; color: string; bg: string }> = {
    TODO: { label: "To do", ...neutral },
    IN_PROGRESS: { label: "In progress", ...info },
    NEEDS_MATERIALS: { label: "Needs materials", ...warn },
    BLOCKED: { label: "Blocked", ...bad },
    DONE: { label: "Done ✓", ...good },
    VERIFIED: { label: "Verified ✓", ...good2 },
    DRAFT: { label: "Not submitted", ...neutral },
    SUBMITTED: { label: "Submitted", ...info },
    APPROVED: { label: "Approved ✓", ...good },
    REJECTED: { label: "Sent back", ...bad },
    EXPORTED: { label: "With payroll", color: c.violetInk, bg: c.violetSoft },
    PAID: { label: "Paid ✓", ...good2 },
    REIMBURSED: { label: "Reimbursed ✓", ...good2 },
  };
  return map[status] ?? { label: status, ...neutral };
}

export function StatusPill({ status }: { status: string }) {
  const c = useColors();
  const s = useStyles();
  const st = statusStyle(c, status);
  return (
    <View style={[s.pill, { backgroundColor: st.bg }]}>
      <Text style={[s.pillText, { color: st.color }]}>{st.label}</Text>
    </View>
  );
}

/** Shared screen styles. Call inside a component: `const s = useStyles()`. */
export const useStyles = makeStyles((c) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.canvas },
    content: { padding: 16, gap: 12 },
    card: { backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.line, padding: 14, gap: 8 },
    h1: { fontSize: 22, fontWeight: "700", color: c.ink },
    h2: { fontSize: 17, fontWeight: "600", color: c.ink },
    body: { fontSize: 15, color: c.ink },
    muted: { fontSize: 13, color: c.muted },
    label: { fontSize: 13, color: c.muted, fontWeight: "500" },
    input: { borderWidth: 1, borderColor: c.lineStrong, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, backgroundColor: c.surface, color: c.ink },
    btn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", minHeight: 44 },
    btnBig: { paddingVertical: 16, minHeight: 56 },
    btnSecondary: { borderWidth: 1, borderColor: c.lineStrong },
    btnText: { fontSize: 15, fontWeight: "600" },
    btnTextBig: { fontSize: 18 },
    pill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    pillText: { fontSize: 12, fontWeight: "600" },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    seg: { flexDirection: "row", borderWidth: 1, borderColor: c.lineStrong, borderRadius: 10, overflow: "hidden" },
    segItem: { flex: 1, paddingVertical: 10, alignItems: "center", backgroundColor: c.surface },
    segActive: { backgroundColor: c.accent },
    segText: { fontWeight: "600", color: c.ink },
    tabular: { fontVariant: ["tabular-nums"] },
  }),
);
