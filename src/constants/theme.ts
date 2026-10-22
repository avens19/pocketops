import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#111214',
    textSecondary: '#60646C',
    background: '#F6F6F8',
    card: '#FFFFFF',
    border: '#E3E4E8',
    backgroundSelected: '#E8E9EE',
    accent: '#E8590C',
    onAccent: '#FFFFFF',
    danger: '#D92D20',
    warning: '#C77700',
    success: '#17803D',
    info: '#2563EB',
  },
  dark: {
    text: '#F4F5F7',
    textSecondary: '#A1A5AD',
    background: '#0B0B0D',
    card: '#17181B',
    border: '#2A2C31',
    backgroundSelected: '#26282D',
    accent: '#FF7A33',
    onAccent: '#111214',
    danger: '#FF6B5E',
    warning: '#F5B84A',
    success: '#4CC38A',
    info: '#6EA2FF',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: { mono: 'ui-monospace' },
  default: { mono: 'monospace' },
}) as { mono: string };

export const Spacing = {
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
} as const;

export const Radius = { small: 8, medium: 12, pill: 999 } as const;
