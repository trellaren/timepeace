import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { useColors } from "@/lib/theme";

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  const c = useColors();
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: c.accentInk, tabBarInactiveTintColor: c.muted, headerTitleStyle: { fontWeight: "700" } }}>
      <Tabs.Screen name="index" options={{ title: "Today", tabBarIcon: icon("◷") }} />
      <Tabs.Screen name="timesheet" options={{ title: "Timesheet", tabBarIcon: icon("▤") }} />
      <Tabs.Screen name="expenses" options={{ title: "Expenses", tabBarIcon: icon("$") }} />
    </Tabs>
  );
}
