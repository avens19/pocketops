import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'heading' | 'small' | 'caption' | 'mono';
  color?: ThemeColor;
};

export function ThemedText({ style, type = 'default', color, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const resolved = color ?? (type === 'caption' ? 'textSecondary' : 'text');
  return <Text style={[{ color: theme[resolved] }, styles[type], style]} {...rest} />;
}

const styles = StyleSheet.create({
  default: { fontSize: 16, lineHeight: 22 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  small: { fontSize: 14, lineHeight: 19 },
  caption: { fontSize: 12, lineHeight: 16 },
  mono: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.mono },
});
