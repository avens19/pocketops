import type { ThemeColor } from '@/constants/theme';

export function severityColor(severity: string): ThemeColor {
  switch (severity) {
    case 'ERROR':
    case 'ERR':
    case 'FATAL':
    case 'CRITICAL':
      return 'danger';
    case 'WARN':
    case 'WARNING':
      return 'warning';
    case 'INFO':
      return 'info';
    default:
      return 'textSecondary';
  }
}
