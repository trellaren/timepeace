import { useMutation } from "@tanstack/react-query";
import { errorMessage, useTRPC } from "@timepeace/api-client";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Field, colors, s } from "@/components/ui";
import { API_URL } from "@/lib/config";
import { useSession } from "@/lib/session";

export default function Login() {
  const trpc = useTRPC();
  const { signIn } = useSession();
  const login = useMutation(trpc.auth.login.mutationOptions());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16 }}>
        <View>
          <Text style={{ fontSize: 32, fontWeight: "800", color: colors.brand }}>timepeace</Text>
          <Text style={s.muted}>Track your time, tasks and expenses on site.</Text>
        </View>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" />
        {login.error && <Text style={{ color: colors.critical }}>{errorMessage(login.error)}</Text>}
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
