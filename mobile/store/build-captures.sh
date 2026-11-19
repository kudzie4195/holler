#!/bin/sh
# Capture builds into /tmp/holler-shots-dist/{ios,android}. Run from mobile/. Env values are throwaway and local (no env files written).
set -e
node store/build-data.mjs
for p in ios android; do
  SHOT_PLATFORM=$p VITE_API_BASE=http://127.0.0.1:8799 VITE_SUPABASE_URL=http://127.0.0.1:8799 VITE_SUPABASE_ANON_KEY=capture-anon \
  VITE_REVENUECAT_IOS_KEY=appl_capture VITE_REVENUECAT_ANDROID_KEY=goog_capture npx vite build -c store/vite.capture.config.mjs
done
python3 store/make-screenshots.py
