import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { linkModalJustClosed } from '@/lib/link-modal';

/** The Open tab is a doorway: arriving here presents the link modal, and this screen is what is left behind it. */
export default function LinkTab() {
  const theme = useTheme();
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      if (!linkModalJustClosed()) router.push('/open-link');
    }, [router]),
  );

  return (
    <View style={styles.content}>
      <ThemedText type="heading">Open a SigNoz link</ThemedText>
      <ThemedText type="small" color="textSecondary" style={styles.text}>
        Paste an alert, service, logs or traces URL from a notification or your browser to jump straight to it here.
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/open-link')}
        style={[styles.button, { backgroundColor: theme.accent }]}>
        <ThemedText color="onAccent" style={styles.bold}>
          Open a link
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
  text: { textAlign: 'center' },
  button: { paddingVertical: 14, paddingHorizontal: Spacing.five, borderRadius: Radius.medium },
  bold: { fontWeight: '700' },
});
