import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth, useClient } from '@/lib/auth';

export default function SettingsScreen() {
  const theme = useTheme();
  const client = useClient();
  const { signOut } = useAuth();

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
          {Updates.updateId ? ` · update ${Updates.updateId.slice(0, 8)}` : ''}
        </ThemedText>
        <ThemedText type="caption">Independent app, not affiliated with SigNoz.</ThemedText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  bold: { fontWeight: '600' },
  danger: { alignItems: 'center', padding: Spacing.three, borderRadius: Radius.medium, borderWidth: StyleSheet.hairlineWidth },
  footer: { alignItems: 'center', gap: 2, marginTop: Spacing.three },
});
