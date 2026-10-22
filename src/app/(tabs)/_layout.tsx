import { NativeTabs } from 'expo-router/native-tabs';

import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <NativeTabs tintColor={theme.accent}>
      <NativeTabs.Trigger name="alerts">
        <NativeTabs.Trigger.Label>Alerts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bell.fill" md="notifications" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="logs">
        <NativeTabs.Trigger.Label>Logs</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="text.alignleft" md="article" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="services">
        <NativeTabs.Trigger.Label>Services</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="waveform.path.ecg" md="monitor_heart" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="metrics">
        <NativeTabs.Trigger.Label>Metrics</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.xyaxis.line" md="show_chart" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="link">
        <NativeTabs.Trigger.Label>Open</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="link" md="link" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
