import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { FieldProvider } from "@/lib/field";
import { SessionProvider, useSession } from "@/lib/session";
import { TrpcProviders } from "@/lib/trpc";

function Root() {
  const { session } = useSession();
  if (session === undefined) return null; // loading secure store
  return (
    <Stack screenOptions={{ headerTintColor: "#256abf" }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="task/[id]" options={{ title: "Task" }} />
        <Stack.Screen name="expense/new" options={{ title: "Add expense", presentation: "modal" }} />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

function WithField() {
  const { session } = useSession();
  // FieldProvider queries the API, so mount it only when signed in (keyed by user).
  return session ? (
    <FieldProvider key={session.user.id}>
      <Root />
    </FieldProvider>
  ) : (
    <Root />
  );
}

export default function Layout() {
  return (
    <SessionProvider>
      <TrpcProviders>
        <StatusBar style="dark" />
        <WithField />
      </TrpcProviders>
    </SessionProvider>
  );
}
