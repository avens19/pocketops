import { useQuery } from '@tanstack/react-query';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { Card } from '@/components/card';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { SearchField } from '@/components/search-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useClient } from '@/lib/auth';
import { isViewSource, listViews } from '@/lib/signoz/views';

export default function SavedViewsScreen() {
  const { source, last, from, to } = useLocalSearchParams<{ source: string; last?: string; from?: string; to?: string }>();
  const client = useClient();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const views = useQuery({
    queryKey: ['saved-views', client.endpoint, source],
    enabled: isViewSource(source),
    queryFn: ({ signal }) => listViews(client, isViewSource(source) ? source : 'logs', signal),
  });
  if (!isViewSource(source)) return <Empty title="Unknown view source" />;
  const rows = (views.data ?? []).filter((v) => v.spec.displayName.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <FlatList data={rows} keyExtractor={(v) => v.id} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: Spacing.three, paddingBottom: insets.bottom + Spacing.three, gap: Spacing.two }}
      refreshControl={<RefreshControl refreshing={views.isRefetching} onRefresh={() => void views.refetch()} />}
      ListHeaderComponent={<View style={{ gap: Spacing.two }}>
        <Stack.Screen options={{ title: `${source[0].toUpperCase()}${source.slice(1)} views` }} />
        <SearchField value={search} onChangeText={setSearch} placeholder="Find a saved view" accessibilityLabel="Find a saved view" />
      </View>}
      ListEmptyComponent={views.isPending ? <Loading /> : views.isError ? <ErrorState error={views.error} onRetry={() => void views.refetch()} /> : <Empty title={search ? 'No matching views' : 'No saved views'} hint="Save a query from the explorer, or create a view in SigNoz." />}
      renderItem={({ item }) => <Link href={{ pathname: '/views/[id]', params: { id: item.id, last, from, to } }} asChild>
        <Pressable accessibilityRole="button"><Card>
          <ThemedText type="heading">{item.spec.displayName}</ThemedText>
          <ThemedText type="caption">{item.spec.panelType} · {item.spec.queries.length} {item.spec.queries.length === 1 ? 'query' : 'queries'}</ThemedText>
        </Card></Pressable>
      </Link>} />
  );
}
