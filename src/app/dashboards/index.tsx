import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '@/components/card';
import { Chip } from '@/components/chip';
import { Empty, ErrorState, Loading } from '@/components/query-state';
import { SearchField } from '@/components/search-field';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useDebounced } from '@/hooks/use-debounced';
import { useClient } from '@/lib/auth';
import { dashboardTitle, listDashboards } from '@/lib/signoz/dashboards';

export default function DashboardsScreen() {
  const client = useClient();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const term = useDebounced(search);
  const dashboards = useInfiniteQuery({ queryKey: ['dashboards', client.endpoint, term], initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => listDashboards(client, term, pageParam, signal),
    getNextPageParam: (last, pages) => { const count = pages.reduce((sum, page) => sum + page.dashboards.length, 0); return last.dashboards.length && count < last.total ? count : undefined; },
  });
  return <FlatList data={dashboards.data?.pages.flatMap((page) => page.dashboards) ?? []} keyExtractor={(d) => d.id}
    contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    contentContainerStyle={{ padding: Spacing.three, paddingBottom: insets.bottom + Spacing.three, gap: Spacing.two }}
    refreshControl={<RefreshControl refreshing={dashboards.isRefetching && !dashboards.isFetchingNextPage} onRefresh={() => void dashboards.refetch()} />}
    ListHeaderComponent={<SearchField value={search} onChangeText={setSearch} placeholder="Find a dashboard" />}
    ListEmptyComponent={dashboards.isPending ? <Loading /> : dashboards.isError ? <ErrorState error={dashboards.error} onRetry={() => void dashboards.refetch()} /> : <Empty title="No dashboards found" />}
    ListFooterComponent={<View>{dashboards.isFetchNextPageError ? <ErrorState error={dashboards.error} onRetry={() => void dashboards.fetchNextPage()} /> : dashboards.hasNextPage ? <Chip label={dashboards.isFetchingNextPage ? 'Loading…' : 'Load more'} onPress={() => { if (!dashboards.isFetchingNextPage) void dashboards.fetchNextPage(); }} /> : null}</View>}
    renderItem={({ item }) => <Link href={{ pathname: '/dashboards/[id]', params: { id: item.id } }} asChild><Pressable accessibilityRole="button"><Card>
      <ThemedText type="heading">{dashboardTitle(item)}</ThemedText>
      {item.spec?.display?.description ? <ThemedText type="small" numberOfLines={3}>{item.spec.display.description}</ThemedText> : null}
    </Card></Pressable></Link>} />;
}
