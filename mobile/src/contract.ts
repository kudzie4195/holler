// The one contract between the Holler server and this app lives in the web repo (lib/mobile/types.ts,
// owned by the server side). It has no imports, so pulling it in adds types and a few constants only.
export * from '../../lib/mobile/types';
