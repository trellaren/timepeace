import { THEME_DESCRIPTIONS, THEME_LABELS, THEME_PREFERENCES, type ThemePreference } from "@timepeace/shared";
import { Text, View } from "react-native";
import { useTheme } from "@/lib/theme";
import { Segmented, useStyles } from "./ui";

/** Display setting for this phone. Sunlight is for reading the screen outdoors in bright sun. */
export function ThemePicker() {
  const s = useStyles();
  const { preference, choose } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>Display</Text>
      <Segmented<ThemePreference> value={preference} onChange={choose} options={THEME_PREFERENCES.map((p) => ({ value: p, label: THEME_LABELS[p] }))} />
      <Text style={s.muted}>{THEME_DESCRIPTIONS[preference]}</Text>
    </View>
  );
}
