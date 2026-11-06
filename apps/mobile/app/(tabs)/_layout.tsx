import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: "#256abf", headerTitleStyle: { fontWeight: "700" } }}>
      <Tabs.Screen name="index" options={{ title: "Today", tabBarIcon: icon("◷") }} />
      <Tabs.Screen name="timesheet" options={{ title: "Timesheet", tabBarIcon: icon("▤") }} />
      <Tabs.Screen name="expenses" options={{ title: "Expenses", tabBarIcon: icon("$") }} />
    </Tabs>
  );
}
