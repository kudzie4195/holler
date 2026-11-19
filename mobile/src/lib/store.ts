// Small key-value storage: @capacitor/preferences on a phone, localStorage in a browser.
import type { KeyValueStore } from '../push/push';
import { isNative } from './platform';

export const keyValueStore: KeyValueStore = {
  async get(key) {
    if (isNative()) {
      const { Preferences } = await import('@capacitor/preferences');
      return (await Preferences.get({ key })).value;
    }
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    if (isNative()) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key, value });
      return;
    }
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* storage blocked */
    }
  },
  async remove(key) {
    if (isNative()) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key });
      return;
    }
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* storage blocked */
    }
  },
};
