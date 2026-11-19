// Capture build only: the app believes it is an iPhone app for plan and store wording, but stays on web code paths (fetch, localStorage)
// because the capture runs in desktop Chrome with no native bridge.
export type Platform = 'ios' | 'android' | 'web';
export function platform(): Platform {
  return 'ios';
}
export function isNative(): boolean {
  return false;
}
