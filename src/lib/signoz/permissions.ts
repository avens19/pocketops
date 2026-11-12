import type { SignozClient } from './client';

export type ViewPermission = { action: 'create'; id?: never } | { action: 'update'; id: string };

export function viewPermissionKey(endpoint: string, permission: ViewPermission) {
  // AuthProvider clears the query cache when credentials change; never put the API key in cache keys.
  return ['view-permission', endpoint, permission.action, permission.id ?? '*'] as const;
}

/** Check the current principal, including custom roles and per-view grants. No write probe or role-name guesses. */
export async function checkViewPermission(client: SignozClient, permission: ViewPermission, signal?: AbortSignal): Promise<boolean> {
  const transaction = {
    relation: permission.action,
    object: { resource: { type: 'metaresource', kind: 'saved-view' }, selector: permission.id ?? '*' },
  };
  const data = await client.request<unknown>('/api/v1/authz/check', { method: 'POST', body: [transaction], signal });
  if (!Array.isArray(data)) throw new Error('SigNoz did not return a permission decision.');
  // Match the echoed transaction, not array position or the truthiness of "authorized".
  const matches = data.filter((entry) => entry?.relation === transaction.relation
    && entry?.object?.resource?.type === 'metaresource'
    && entry?.object?.resource?.kind === 'saved-view'
    && entry?.object?.selector === transaction.object.selector);
  if (matches.length !== 1 || typeof matches[0].authorized !== 'boolean') throw new Error('SigNoz did not return a permission decision.');
  return matches[0].authorized;
}
