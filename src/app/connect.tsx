import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { SignozClient, normalizeEndpoint } from '@/lib/signoz/client';

export default function ConnectScreen() {
  const theme = useTheme();
  const { signIn } = useAuth();
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = endpoint.trim().length > 0 && apiKey.trim().length > 0 && !busy;

  async function connect() {
    setError(null);
    const normalized = normalizeEndpoint(endpoint);
    if (!normalized.ok) {
      setError(normalized.error);
      return;
    }
    const credentials = { endpoint: normalized.endpoint, apiKey: apiKey.trim() };
    setBusy(true);
    try {
      await new SignozClient(credentials).verify();
      await signIn(credentials);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect.');
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = [styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }];

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <ThemedText type="title">PocketOps</ThemedText>
            <ThemedText color="textSecondary">Alerts, logs and services from your SigNoz, on your phone.</ThemedText>
          </View>

          <View style={styles.field}>
            <ThemedText type="small" style={styles.label}>
              SigNoz URL
            </ThemedText>
            <TextInput
              value={endpoint}
              onChangeText={setEndpoint}
              placeholder="signoz.example.com"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
              style={inputStyle}
            />
          </View>

          <View style={styles.field}>
            <ThemedText type="small" style={styles.label}>
              API key
            </ThemedText>
            <TextInput
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="Service account key"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType="password"
              onSubmitEditing={canSubmit ? connect : undefined}
              style={inputStyle}
            />
            <ThemedText type="caption">
              Create one in SigNoz under Settings → Service Accounts. A Viewer-role key is enough, and it keeps this app
              read-only. The key is stored in this device&apos;s secure storage and sent only to your server.
            </ThemedText>
          </View>

          {error ? (
            <ThemedText type="small" color="danger" accessibilityRole="alert">
              {error}
            </ThemedText>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={connect}
            style={[styles.button, { backgroundColor: theme.accent, opacity: canSubmit ? 1 : 0.5 }]}>
            {busy ? (
              <ActivityIndicator color={theme.onAccent} />
            ) : (
              <ThemedText color="onAccent" style={styles.buttonText}>
                Connect
              </ThemedText>
            )}
          </Pressable>

          <ThemedText type="caption" style={styles.disclaimer}>
            PocketOps is an independent app and is not affiliated with or endorsed by SigNoz.
          </ThemedText>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three, flexGrow: 1, justifyContent: 'center' },
  header: { gap: Spacing.two, marginBottom: Spacing.three },
  field: { gap: 6 },
  label: { fontWeight: '600' },
  input: {
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  button: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: Radius.medium, minHeight: 50 },
  buttonText: { fontWeight: '700' },
  disclaimer: { textAlign: 'center', marginTop: Spacing.three },
});
