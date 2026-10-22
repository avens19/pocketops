import { useQuery } from '@tanstack/react-query';

import { useClient } from '@/lib/auth';
import { listRules } from '@/lib/signoz/api';

export function useRules() {
  const client = useClient();
  return useQuery({
    queryKey: ['rules', client.endpoint],
    queryFn: ({ signal }) => listRules(client, signal),
    refetchInterval: 30_000,
  });
}
