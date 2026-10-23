import { Link, Stack } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { useTheme } from '@/hooks/use-theme';

/** The stack each tab lives in: a large-title root screen, with detail screens pushed over it. */
export function TabStack({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        // On iOS 26 a header background colour makes the large title invisible. The transparent system header sits over
        // `contentStyle`, which is the same colour, so it looks identical.
        headerStyle: Platform.OS === 'ios' ? undefined : { backgroundColor: theme.background },
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
            <View style={styles.actions}>
              <Link href="/open-link" asChild>
                <Pressable accessibilityRole="button" accessibilityLabel="Open a SigNoz link" hitSlop={10} style={styles.action}>
                  <Icon name="link" size={22} color={theme.accent} />
                </Pressable>
              </Link>
              <Link href="/settings" asChild>
                <Pressable accessibilityRole="button" accessibilityLabel="Settings" hitSlop={10} style={styles.action}>
                  <Icon name="settings" size={22} color={theme.accent} />
                </Pressable>
              </Link>
            </View>
          ),
        }}
      />
    </Stack>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  action: { padding: 6 },
});
