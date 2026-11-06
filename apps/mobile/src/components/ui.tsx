import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";

export const colors = {
  brand: "#256abf",
  brandDark: "#1c5cab",
  brandLight: "#eef5fd",
  bg: "#f5f5f3",
  card: "#ffffff",
  border: "#e7e5e4",
  text: "#1c1917",
  muted: "#78716c",
  good: "#0ca30c",
  warning: "#b45309",
  warningBg: "#fffbeb",
  critical: "#d03b3b",
  criticalBg: "#fef2f2",
};

export function Button({ title, onPress, variant = "primary", disabled, loading, style, big }: { title: string; onPress: () => void; variant?: "primary" | "secondary" | "danger" | "success"; disabled?: boolean; loading?: boolean; style?: ViewStyle; big?: boolean }) {
  const bg = { primary: colors.brand, secondary: colors.card, danger: colors.critical, success: colors.good }[variant];
  const fg = variant === "secondary" ? colors.text : "#fff";
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
  return <View style={[s.card, style]}>{children}</View>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor="#a8a29e" {...props} style={[s.input, props.multiline && { minHeight: 72, textAlignVertical: "top" }]} />
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={s.seg}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.segItem, value === o.value && s.segActive]} accessibilityRole="button" accessibilityState={{ selected: value === o.value }}>
          <Text style={[s.segText, value === o.value && { color: "#fff" }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  TODO: { label: "To do", color: colors.muted, bg: "#f5f5f4" },
  IN_PROGRESS: { label: "In progress", color: colors.brandDark, bg: colors.brandLight },
  NEEDS_MATERIALS: { label: "Needs materials", color: colors.warning, bg: colors.warningBg },
  BLOCKED: { label: "Blocked", color: colors.critical, bg: colors.criticalBg },
  DONE: { label: "Done ✓", color: "#166534", bg: "#f0fdf4" },
  VERIFIED: { label: "Verified ✓", color: "#166534", bg: "#dcfce7" },
  DRAFT: { label: "Not submitted", color: colors.muted, bg: "#f5f5f4" },
  SUBMITTED: { label: "Submitted", color: colors.brandDark, bg: colors.brandLight },
  APPROVED: { label: "Approved ✓", color: "#166534", bg: "#f0fdf4" },
  REJECTED: { label: "Sent back", color: colors.critical, bg: colors.criticalBg },
  EXPORTED: { label: "With payroll", color: "#5b21b6", bg: "#f5f3ff" },
  PAID: { label: "Paid ✓", color: "#166534", bg: "#dcfce7" },
  REIMBURSED: { label: "Reimbursed ✓", color: "#166534", bg: "#dcfce7" },
};

export function StatusPill({ status }: { status: string }) {
  const st = STATUS[status] ?? { label: status, color: colors.muted, bg: "#f5f5f4" };
  return (
    <View style={[s.pill, { backgroundColor: st.bg }]}>
      <Text style={[s.pillText, { color: st.color }]}>{st.label}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 },
  h1: { fontSize: 22, fontWeight: "700", color: colors.text },
  h2: { fontSize: 17, fontWeight: "600", color: colors.text },
  body: { fontSize: 15, color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  label: { fontSize: 13, color: colors.muted, fontWeight: "500" },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, backgroundColor: "#fff", color: colors.text },
  btn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: "center", justifyContent: "center", minHeight: 44 },
  btnBig: { paddingVertical: 16, minHeight: 56 },
  btnSecondary: { borderWidth: 1, borderColor: colors.border },
  btnText: { fontSize: 15, fontWeight: "600" },
  btnTextBig: { fontSize: 18 },
  pill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 12, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  seg: { flexDirection: "row", borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: "hidden" },
  segItem: { flex: 1, paddingVertical: 10, alignItems: "center", backgroundColor: "#fff" },
  segActive: { backgroundColor: colors.brand },
  segText: { fontWeight: "600", color: colors.text },
  tabular: { fontVariant: ["tabular-nums"] },
});
