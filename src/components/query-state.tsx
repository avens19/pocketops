import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { SignozError } from '@/lib/signoz/client';

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator />
    </View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.center}>
      <ThemedText type="heading">{title}</ThemedText>
      {hint ? (
        <ThemedText type="small" color="textSecondary" style={styles.text}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

function describe(error: unknown): { title: string; hint: string } {
  if (error instanceof SignozError) {
    switch (error.kind) {
      case 'auth':
        return { title: 'API key rejected', hint: 'Update the key under Settings.' };
      case 'forbidden':
        return { title: 'Not allowed', hint: error.message };
      case 'not-found':
        return { title: 'Not supported by this server', hint: 'This SigNoz version may predate this feature.' };
      default:
        return { title: 'Something went wrong', hint: error.message };
    }
  }
  return { title: 'Something went wrong', hint: error instanceof Error ? error.message : String(error) };
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const theme = useTheme();
  const { title, hint } = describe(error);
  return (
    <View style={styles.center}>
      <ThemedText type="heading">{title}</ThemedText>
      <ThemedText type="small" color="textSecondary" style={styles.text}>
        {hint}
      </ThemedText>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={[styles.retry, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="small" style={{ fontWeight: '600' }}>
            Try again
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', padding: Spacing.five, gap: Spacing.two },
  text: { textAlign: 'center' },
  retry: { marginTop: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: 8, borderRadius: Radius.small },
});
