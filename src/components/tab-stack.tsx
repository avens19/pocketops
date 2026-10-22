import { Link, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';

import { useTheme } from '@/hooks/use-theme';

/** The stack each tab lives in: a large-title root screen, with detail screens pushed over it. */
export function TabStack({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.accent,
        headerTitleStyle: { color: theme.text },
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Screen
        name="index"
        options={{
          title,
          headerLargeTitleEnabled: true,
          headerLargeTitleShadowVisible: false,
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable accessibilityRole="button" accessibilityLabel="Settings" hitSlop={12}>
                <SymbolView
                  name="gearshape"
                  size={22}
                  tintColor={theme.accent}
                  fallback={<ThemedText color="accent">Settings</ThemedText>}
                />
              </Pressable>
            </Link>
          ),
        }}
      />
    </Stack>
  );
}
