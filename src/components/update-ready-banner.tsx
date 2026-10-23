import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUpdateStatus } from '@/hooks/use-update-status';
import { useConnection } from '@/lib/connection';
import { UPDATE_INSTALL_FAILED } from '@/lib/update-status';

/**
 * A one-shot nudge that a downloaded update is waiting for a restart, above whichever tab is open. Settings has the same button, but
 * only reaches someone who goes looking, and the app is built to stay open for days, so nothing else would ever prompt them.
 *
 * A banner, not a modal: it can be waved away mid-investigation. Dismissing loses nothing, since Settings keeps offering the restart,
 * so "once" only has to last for the session. It sits below the connection banner when that one is showing.
 */
export function UpdateReadyBanner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { failing } = useConnection();
  const { status, install, busy, failed } = useUpdateStatus();
  const [dismissed, setDismissed] = useState(false);

  if (status !== 'readyToRestart' || dismissed) return null;

  const message = failed ? UPDATE_INSTALL_FAILED : 'Update ready. Restart to finish.';
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + Spacing.one + (failing ? 72 : 0) }]}>
      <View accessible accessibilityLiveRegion="polite" accessibilityLabel={message} style={styles.announce} />
      <View style={[styles.pill, { backgroundColor: theme.card, borderColor: theme.accent }]}>
        <ThemedText type="small" style={styles.message}>
          {message}
        </ThemedText>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void install()} hitSlop={Spacing.two}>
          {busy ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : (
            <ThemedText type="small" color="accent" style={styles.action}>
              Restart
            </ThemedText>
          )}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Not now" onPress={() => setDismissed(true)} hitSlop={Spacing.two}>
          <ThemedText type="small" color="textSecondary">
            Not now
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: Spacing.three, right: Spacing.three, alignItems: 'center', zIndex: 10 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.medium,
    borderWidth: 1,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  announce: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  message: { flexShrink: 1 },
  action: { fontWeight: '700' },
});
