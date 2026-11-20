// Capture build only: stands in for the native @capacitor-firebase/messaging plugin, which needs a phone. It answers as a phone
// whose owner allowed notifications: permission granted and one FCM token. Nothing is sent anywhere; the token goes only to the
// capture mock API (store/mock-api.mjs answers /api/m/push/register with ok). With it, the app's own Settings screen shows the
// state a member with push and email alerts on sees (store shot 05).
const listener = { remove: async () => undefined };
export const FirebaseMessaging = {
  checkPermissions: async () => ({ receive: 'granted' }),
  requestPermissions: async () => ({ receive: 'granted' }),
  getToken: async () => ({ token: 'capture-fcm-token' }),
  deleteToken: async () => undefined,
  createChannel: async () => undefined,
  addListener: async () => listener,
  removeAllListeners: async () => undefined,
};
