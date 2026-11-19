export type Route =
  | { name: 'welcome' }
  | { name: 'auth'; mode: 'signin' | 'signup' | 'forgot' }
  | { name: 'check' }
  | { name: 'onboarding' }
  | { name: 'push-prompt' }
  | { name: 'feed' }
  | { name: 'alert'; signalId: number }
  | { name: 'settings' }
  | { name: 'profile' }
  | { name: 'paywall' }
  | { name: 'delete' };

export type TabName = 'feed' | 'check' | 'settings';

export function tabOf(route: Route): TabName | null {
  if (route.name === 'feed' || route.name === 'alert') return 'feed';
  if (route.name === 'check') return 'check';
  if (route.name === 'settings' || route.name === 'profile' || route.name === 'paywall' || route.name === 'delete') return 'settings';
  return null;
}
