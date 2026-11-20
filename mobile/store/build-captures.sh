#!/bin/sh
# Builds the store screenshots from the real app. Run from mobile/: sh store/build-captures.sh
# Capture builds go to store/.gen/dist/{ios,android}. Env values are throwaway and local (no env files written).
set -e
node store/build-data.mjs > store/.gen/build-data.log
for p in ios android; do
  SHOT_PLATFORM=$p VITE_API_BASE=http://127.0.0.1:8799 VITE_SUPABASE_URL=http://127.0.0.1:8799 VITE_SUPABASE_ANON_KEY=capture-anon \
  VITE_REVENUECAT_IOS_KEY=appl_capture VITE_REVENUECAT_ANDROID_KEY=goog_capture VITE_PUSH_ENABLED=true npx vite build -c store/vite.capture.config.mjs --logLevel warn
done
python3 store/make-screenshots.py
python3 store/check-screenshots.py
