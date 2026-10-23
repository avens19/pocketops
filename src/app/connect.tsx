import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
  const [showKey, setShowKey] = useState(false);
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

  async function pasteKey() {
    const clip = (await Clipboard.getStringAsync().catch(() => '')).trim();
    if (clip) {
      setApiKey(clip);
      setError(null);
    }
  }

  const inputStyle = [styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }];

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
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
              accessibilityLabel="SigNoz URL"
              style={inputStyle}
            />
            <ThemedText type="caption">
              The address you open SigNoz at. https works anywhere; plain http is only accepted for addresses on your own
              network (like 192.168.x.x, a .local name, or Tailscale).
            </ThemedText>
          </View>

          <View style={styles.field}>
            <View style={styles.labelRow}>
              <ThemedText type="small" style={[styles.label, styles.labelFill]}>
                API key
              </ThemedText>
              <View style={styles.labelActions}>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setShowKey((v) => !v)}>
                  <ThemedText type="small" color="accent" style={styles.label}>
                    {showKey ? 'Hide' : 'Show'}
                  </ThemedText>
                </Pressable>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={pasteKey}>
                  <ThemedText type="small" color="accent" style={styles.label}>
                    Paste
                  </ThemedText>
                </Pressable>
              </View>
            </View>
            <TextInput
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="Service account key"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!showKey}
              textContentType="password"
              accessibilityLabel="API key"
              onSubmitEditing={canSubmit ? connect : undefined}
              style={inputStyle}
            />
            <ThemedText type="caption">
              To make a key: in SigNoz open Settings → Service Accounts, create an account with the Viewer role, then add a key
              and copy it here. A Viewer key keeps this app read-only. The key is stored in this device&apos;s secure storage
              and sent only to your server.
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
  // Fill the row rather than shrink-wrap: on Android the bold text was measured narrower than it draws, so "key" wrapped and was clipped.
  labelFill: { flex: 1 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  labelActions: { flexDirection: 'row', gap: Spacing.three },
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
