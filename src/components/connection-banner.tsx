import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { retryConnection, useConnection } from '@/lib/connection';
import { timeAgo } from '@/lib/format';

/**
 * Says so when refreshes are failing. Screens keep their last data on screen when a request fails, which looks healthy;
 * for a monitoring app, stale data that looks live is the worst failure, so it is flagged here for every screen at once.
 */
export function ConnectionBanner() {
  const { failing } = useConnection();
  return failing ? <Banner /> : null;
}

function Banner() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { kind, lastOkAt } = useConnection();
  // Mounted only while failing, so this starts fresh each time; the tick keeps "last updated" honest while it stays up.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const auth = kind === 'auth';
  const title = auth ? 'API key rejected' : kind === 'server' ? 'SigNoz returned an error' : 'Can’t reach the server';
  const detail = auth
    ? 'Disconnect in Settings and connect again with a valid key.'
    : lastOkAt
      ? `Showing data from ${timeAgo(lastOkAt, now)}. Tap to retry.`
      : 'Tap to retry.';

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + Spacing.one }]}>
      <Pressable
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${title}. ${detail}`}
        onPress={() => (auth ? router.push('/settings') : retryConnection())}
        style={[styles.pill, { backgroundColor: theme.card, borderColor: theme.danger }]}>
        <View style={[styles.dot, { backgroundColor: theme.danger }]} />
        <View style={styles.text}>
          <ThemedText type="small" style={styles.title}>
            {title}
          </ThemedText>
          <ThemedText type="caption">{detail}</ThemedText>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: Spacing.three, right: Spacing.three, alignItems: 'center', zIndex: 10 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.medium,
    borderWidth: 1,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { flexShrink: 1 },
  title: { fontWeight: '700' },
});
