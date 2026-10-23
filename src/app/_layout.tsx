import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { ConnectionBanner } from '@/components/connection-banner';
import { UpdateReadyBanner } from '@/components/update-ready-banner';
import { startUpdateChecks } from '@/hooks/use-update-status';
import { useTheme } from '@/hooks/use-theme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { watchConnection } from '@/lib/connection';
import { queryClient, setupFocusManager } from '@/lib/query';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const scheme = useColorScheme();
  useEffect(setupFocusManager, []);
  useEffect(watchConnection, []);
  // Not gated on a session: a phone on the connect screen should pick up newer code like any other.
  useEffect(startUpdateChecks, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
          <StatusBar style="auto" />
          <Navigator />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function Navigator() {
  const { state } = useAuth();
  const theme = useTheme();

  useEffect(() => {
    if (state.status !== 'loading') SplashScreen.hideAsync();
  }, [state.status]);

  if (state.status === 'loading') return null;
  const signedIn = state.status === 'signed-in';

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.accent,
          headerTitleStyle: { color: theme.text },
          contentStyle: { backgroundColor: theme.background },
        }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="open-link"
            options={{ headerShown: true, presentation: 'modal', title: 'Open a SigNoz link' }}
          />
          <Stack.Screen name="settings" options={{ headerShown: true, title: 'Settings' }} />
          <Stack.Screen name="trace/[id]" options={{ headerShown: true, title: 'Trace' }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="connect" />
        </Stack.Protected>
      </Stack>
      {signedIn ? <ConnectionBanner /> : null}
      <UpdateReadyBanner />
    </>
  );
}
