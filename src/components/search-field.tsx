import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function SearchField(props: TextInputProps) {
  const theme = useTheme();
  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      clearButtonMode="while-editing"
      returnKeyType="search"
      placeholderTextColor={theme.textSecondary}
      {...props}
      style={[
        styles.input,
        { backgroundColor: theme.card, borderColor: theme.border, color: theme.text },
        props.style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    fontSize: 16,
    paddingHorizontal: Spacing.three - 2,
    paddingVertical: 10,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
