import { Capacitor } from '@capacitor/core';

export type Platform = 'ios' | 'android' | 'web';

export function platform(): Platform {
  try {
    const p = Capacitor.getPlatform();
    return p === 'ios' || p === 'android' ? p : 'web';
  } catch {
    return 'web';
  }
}

export function isNative(): boolean {
  return platform() !== 'web';
}
