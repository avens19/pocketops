import { Redirect } from 'expo-router';

import { useAuth } from '@/lib/auth';

/** `/` has no screen of its own: the tab routes sit in the (tabs) group. Send each state to its own home rather than
 *  relying on the auth guard to bounce a protected target, which loops back here. */
export default function Index() {
  const { state } = useAuth();
  return <Redirect href={state.status === 'signed-in' ? '/alerts' : '/connect'} />;
}
