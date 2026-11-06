import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider, Stack, type Theme } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useMemo, type ReactNode } from "react";
import { FieldProvider } from "@/lib/field";
import { SessionProvider, useSession } from "@/lib/session";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { TrpcProviders } from "@/lib/trpc";

function Root() {
  const { session } = useSession();
  const { colors } = useTheme();
  if (session === undefined) return null; // loading secure store
  return (
    <Stack screenOptions={{ headerTintColor: colors.accentInk }}>
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

/** Headers, tab bar and screen backgrounds follow the app theme too. */
function Themed({ children }: { children: ReactNode }) {
  const { name, colors } = useTheme();
  const nav = useMemo<Theme>(() => {
    const base = name === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: { ...base.colors, primary: colors.accentInk, background: colors.canvas, card: colors.surface, text: colors.ink, border: colors.line, notification: colors.critical },
    };
  }, [name, colors]);
  return (
    <NavigationThemeProvider value={nav}>
      <StatusBar style={name === "dark" ? "light" : "dark"} />
      {children}
    </NavigationThemeProvider>
  );
}

export default function Layout() {
  return (
    <ThemeProvider>
      <Themed>
        <SessionProvider>
          <TrpcProviders>
            <WithField />
          </TrpcProviders>
        </SessionProvider>
      </Themed>
    </ThemeProvider>
  );
}
