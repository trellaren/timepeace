import { useMutation } from "@tanstack/react-query";
import { errorMessage, useTRPC } from "@timepeace/api-client";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Share, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ThemePicker } from "@/components/ThemePicker";
import { Button, Card, Field, useColors, useStyles } from "@/components/ui";
import { API_URL } from "@/lib/config";
import { unsyncedByWorker } from "@/lib/db";
import { summarizeUnsynced } from "@/lib/outbox";
import { useSession } from "@/lib/session";

type Unsynced = Awaited<ReturnType<typeof unsyncedByWorker>>;

export default function Login() {
  const s = useStyles();
  const colors = useColors();
  const trpc = useTRPC();
  const { signIn, notice } = useSession();
  const login = useMutation(trpc.auth.login.mutationOptions());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [unsynced, setUnsynced] = useState<Unsynced>([]);

  useEffect(() => {
    unsyncedByWorker().then(setUnsynced);
  }, []);

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
          <View>
            <Text style={{ fontSize: 32, fontWeight: "800", color: colors.accentInk }}>timepeace</Text>
            <Text style={s.muted}>Track your time, tasks and expenses on site.</Text>
          </View>

          {notice && (
            <View accessibilityRole="alert" style={{ backgroundColor: colors.warningSoft, borderRadius: 10, padding: 12 }}>
              <Text style={{ color: colors.warningInk }}>
                <Text accessibilityElementsHidden>▲ </Text>
                {notice}
              </Text>
            </View>
          )}

          {unsynced.map((g) => (
            <Card key={g.userId}>
              <Text style={s.h2}>Saved on this phone for {g.name}</Text>
              <Text style={s.body}>
                {g.rows.length} change{g.rows.length === 1 ? "" : "s"} (clock-ins, tasks or expenses) haven&apos;t uploaded yet. They&apos;ll upload as soon as {g.name} signs in here.
                If that isn&apos;t possible, share them with your manager so your hours still get paid.
              </Text>
              <Button
                variant="secondary"
                title="Share with manager"
                onPress={() => void Share.share({ message: summarizeUnsynced(g.name, g.rows, (iso) => new Date(iso).toLocaleString()) })}
              />
            </Card>
          ))}

          <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" />
          {login.error && <Text style={{ color: colors.criticalInk }}>{errorMessage(login.error)}</Text>}
          <Button
            big
            title="Sign in"
            loading={login.isPending}
            onPress={async () => {
              const res = await login.mutateAsync({ email, password }).catch(() => null);
              if (res) await signIn(res);
            }}
          />
          {!API_URL.startsWith("https://") && <Text style={[s.muted, { textAlign: "center" }]}>Demo: jake@acme.test / timepeace</Text>}
          <ThemePicker />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
