import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { checkForUpdateNow, useUpdateStatus } from '@/hooks/use-update-status';
import { useAuth, useClient } from '@/lib/auth';
import { UPDATE_ACTION_LABEL, UPDATE_INSTALL_FAILED, updateAction, updateMessage } from '@/lib/update-status';

export default function SettingsScreen() {
  const theme = useTheme();
  const client = useClient();
  const { signOut } = useAuth();
  const { status, install, busy, failed } = useUpdateStatus();
  const message = updateMessage(status);
  const action = updateAction(status);

  function runAction() {
    if (action === 'check') void checkForUpdateNow();
    else void install();
  }

  function confirmSignOut() {
    Alert.alert('Disconnect?', 'The server URL and API key will be removed from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => signOut() },
    ]);
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
      <Card>
        <ThemedText type="caption">Connected to</ThemedText>
        <ThemedText selectable>{client.endpoint}</ThemedText>
        <ThemedText type="caption">API key ••••{client.credentials.apiKey.slice(-4)}</ThemedText>
      </Card>

      {message ? (
        <Card>
          <ThemedText type="caption">Updates</ThemedText>
          <View accessible accessibilityLiveRegion="polite">
            <ThemedText>{message}</ThemedText>
          </View>
          <ThemedText type="caption">
            {Updates.isEmbeddedLaunch || !Updates.updateId
              ? 'Running the version built into the app'
              : `Running update ${Updates.updateId.slice(0, 8)}`}
          </ThemedText>
          {action ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={runAction}
              style={[styles.action, { borderColor: theme.border, backgroundColor: theme.background }]}>
              {busy ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <ThemedText color="accent" style={styles.bold}>
                  {UPDATE_ACTION_LABEL[action]}
                </ThemedText>
              )}
            </Pressable>
          ) : null}
          {failed ? (
            <ThemedText type="small" color="danger">
              {UPDATE_INSTALL_FAILED}
            </ThemedText>
          ) : null}
        </Card>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={confirmSignOut}
        style={[styles.danger, { borderColor: theme.border, backgroundColor: theme.card }]}>
        <ThemedText color="danger" style={styles.bold}>
          Disconnect
        </ThemedText>
      </Pressable>

      <View style={styles.footer}>
        <ThemedText type="caption">
          PocketOps {Constants.expoConfig?.version}
        </ThemedText>
        <ThemedText type="caption">Independent app, not affiliated with SigNoz.</ThemedText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  bold: { fontWeight: '600' },
  action: { alignItems: 'center', padding: Spacing.two + 2, borderRadius: Radius.medium, borderWidth: StyleSheet.hairlineWidth, marginTop: Spacing.one },
  danger: { alignItems: 'center', padding: Spacing.three, borderRadius: Radius.medium, borderWidth: StyleSheet.hairlineWidth },
  footer: { alignItems: 'center', gap: 2, marginTop: Spacing.three },
});
