import { useEffect, useState } from "react";
import { Text, type TextStyle } from "react-native";

export function Elapsed({ since, style }: { since: string; style?: TextStyle }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const sec = secs % 60;
  return <Text style={[{ fontVariant: ["tabular-nums"] }, style]}>{`${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`}</Text>;
}
