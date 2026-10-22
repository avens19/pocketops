import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { firstUrl, routeForUrl } from '@/lib/deeplink';
import { markLinkModalClosed } from '@/lib/link-modal';

/** Link entry: takes a SigNoz web URL (or this app's own scheme) and opens the matching screen. */
export default function OpenLinkScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => markLinkModalClosed, []);

  async function paste() {
    const clip = await Clipboard.getStringAsync().catch(() => '');
    if (!clip.trim()) {
      setError('The clipboard is empty.');
      return;
    }
    setText(firstUrl(clip) ?? clip.trim());
    setError(null);
  }

  function open() {
    const url = firstUrl(text) ?? text.trim();
    const route = routeForUrl(url);
    if (!route) {
      setError('That is not a SigNoz alert, service, logs or traces link.');
      return;
    }
    router.dismiss();
    router.push(route as never);
  }

  return (
    <View style={styles.content}>
      <TextInput
        value={text}
        onChangeText={(v) => {
          setText(v);
          setError(null);
        }}
        placeholder="https://signoz.example.com/alerts/overview?ruleId=…"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        style={[styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.text }]}
      />
      {error ? (
        <ThemedText type="small" color="danger">
          {error}
        </ThemedText>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={paste}
        style={[styles.button, { backgroundColor: theme.card, borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth }]}>
        <ThemedText color="accent" style={styles.bold}>
          Paste link
        </ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={open}
        disabled={!text.trim()}
        style={[styles.button, { backgroundColor: theme.accent, opacity: text.trim() ? 1 : 0.5 }]}>
        <ThemedText color="onAccent" style={styles.bold}>
          Open
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  input: {
    minHeight: 96,
    fontSize: 15,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    textAlignVertical: 'top',
  },
  button: { alignItems: 'center', paddingVertical: 14, borderRadius: Radius.medium },
  bold: { fontWeight: '700' },
});
