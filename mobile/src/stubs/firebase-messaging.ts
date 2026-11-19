// Stand-in for the Firebase JS SDK's 'firebase/messaging' entry (aliased in vite.config.ts).
// @capacitor-firebase/messaging only loads its web implementation in a browser, and Holler
// has no web push, so every call reports "not supported" instead of shipping the SDK.
export async function isSupported(): Promise<boolean> {
  return false;
}
export function getMessaging(): never {
  throw new Error('Web push is not part of the Holler app.');
}
export async function getToken(): Promise<never> {
  throw new Error('Web push is not part of the Holler app.');
}
export async function deleteToken(): Promise<boolean> {
  return false;
}
export function onMessage(): () => void {
  return () => undefined;
}
