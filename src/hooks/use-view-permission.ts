import { useQuery } from '@tanstack/react-query';

import { useClient } from '@/lib/auth';
import { checkViewPermission, viewPermissionKey, type ViewPermission } from '@/lib/signoz/permissions';

export function useViewPermission(permission: ViewPermission) {
  const client = useClient();
  const query = useQuery({
    queryKey: viewPermissionKey(client.endpoint, permission),
    queryFn: ({ signal }) => checkViewPermission(client, permission, signal),
    staleTime: 60_000,
    retry: false,
  });
  return { ...query, allowed: query.isSuccess && query.data === true };
}
