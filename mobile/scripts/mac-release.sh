#!/bin/zsh
# Holler: one command from a Mac to an App Store Connect upload (iOS) and a signed AAB (Android).
#
#   zsh "$HOME/Projects/holler/mobile/scripts/mac-release.sh"
#   zsh "$HOME/Projects/holler/mobile/scripts/mac-release.sh" --ios-only
#   zsh "$HOME/Projects/holler/mobile/scripts/mac-release.sh" --android-only
#   zsh "$HOME/Projects/holler/mobile/scripts/mac-release.sh" --dry-run
#
# What it does, in order:
#   1. Checks the tools it needs (it installs nothing).
#   2. Clones or fetches the repo into $HOME/Projects/holler, and hard-syncs branch r12-ready to origin,
#      but only when the working tree is clean.
#   3. Writes mobile/.env.production.local with the public build values, only when that file is absent.
#   4. npm ci, npm test, npm run build, npx cap sync, plus the repo's own sync and bundle checks.
#   5. iOS: xcodebuild archive, then xcodebuild -exportArchive with destination "upload". That sends the
#      build to App Store Connect with the Apple account signed in to Xcode.
#   6. Android: creates the upload keystore if it is missing, asks for its password (the one prompt that
#      is yours: nothing is written to disk or printed), runs ./gradlew :app:bundleRelease, copies the AAB.
#   Everything lands in $HOME/Projects/holler-release/<date-time>/. iOS and Android are independent:
#   when iOS fails the script still builds Android, and the summary at the end reports both.
#
# --dry-run prints every command and writes nothing. HOLLER_REPO_DIR and HOLLER_STUDIO_JAVA_HOME override the
# repo path and Android Studio's Java folder (used for testing the script off a Mac).

setopt ERR_EXIT PIPE_FAIL NO_UNSET

# The step below hard-resets the checkout this file lives in, so run from a private copy: zsh reads a
# script while it runs, and a file that changes underneath it can derail the run.
if [[ -z "${HOLLER_MAC_RELEASE_COPY:-}" ]]; then
  _copy="$(mktemp "${TMPDIR:-/tmp}/holler-mac-release.XXXXXX")"
  cp "$0" "$_copy"
  HOLLER_MAC_RELEASE_COPY=1 exec zsh "$_copy" "$@"
fi

REPO_URL="https://github.com/kudzie4195/holler.git"
REPO_DIR="${HOLLER_REPO_DIR:-$HOME/Projects/holler}"
BRANCH="r12-ready"
TEAM_ID="B3B65JKTQ7"
KEYSTORE="$HOME/keys/holler-upload.jks"
KEY_ALIAS="holler-upload"
STUDIO_JAVA_HOME="${HOLLER_STUDIO_JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
ANDROID_SDK="$HOME/Library/Android/sdk"
OUT="$HOME/Projects/holler-release/$(date +%Y%m%d-%H%M%S)"

DRY=0
DO_IOS=1
DO_ANDROID=1

usage() {
  print -r -- "Usage: zsh mac-release.sh [--ios-only | --android-only] [--dry-run]"
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --ios-only) DO_ANDROID=0 ;;
    --android-only) DO_IOS=0 ;;
    -h|--help) usage; exit 0 ;;
    *) print -ru2 -- "Unknown option: $arg"; usage >&2; exit 2 ;;
  esac
done
if (( DO_IOS == 0 && DO_ANDROID == 0 )); then
  print -ru2 -- "--ios-only and --android-only cancel each other out. Pick one, or neither for both."
  exit 2
fi

say() { print -r -- "$*"; }
step() { print -r -- ""; print -r -- "== $*"; }
fail() { print -ru2 -- ""; print -ru2 -- "STOP: $*"; exit 1; }

# Print the command (shell-quoted), then run it unless this is a dry run.
run() {
  print -r -- "+ ${(j: :)${(@q)@}}"
  if (( DRY )); then return 0; fi
  "$@"
}

# Print the command, then run it with all its output going to a log file only (nothing on the screen).
run_quiet() {
  local log="$1"; shift
  print -r -- "+ ${(j: :)${(@q)@}}"
  if (( DRY )); then return 0; fi
  "$@" >> "$log" 2>&1
}

# Same as run, with everything it prints also appended to a log file. A failing command fails the pipeline.
run_logged() {
  local log="$1"; shift
  print -r -- "+ ${(j: :)${(@q)@}}"
  if (( DRY )); then return 0; fi
  "$@" 2>&1 | tee -a "$log"
}

# ---------------------------------------------------------------------------------------------------
# 1. Prerequisites. Collect every problem, print them all, then stop.
# ---------------------------------------------------------------------------------------------------
check_prereqs() {
  step "1. Checking tools"
  local -a problems
  problems=()

  command -v git >/dev/null 2>&1 || problems+=("git is missing. Install the Xcode command line tools: xcode-select --install")

  if ! command -v node >/dev/null 2>&1; then
    problems+=("node is missing. Install Node 22: nvm install 22 && nvm use 22   (or: brew install node@22 && brew link --overwrite --force node@22)")
  else
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if [[ "$major" != "22" ]]; then
      problems+=("node is v$(node -v | sed 's/^v//') and this project needs Node 22. Switch with: nvm install 22 && nvm use 22   (or: brew install node@22 && brew link --overwrite --force node@22). Then run this script again. It does not install anything.")
    fi
  fi
  command -v npm >/dev/null 2>&1 || problems+=("npm is missing (it comes with Node 22).")

  if (( DO_IOS )); then
    if ! command -v xcodebuild >/dev/null 2>&1; then
      problems+=("xcodebuild is missing. Install Xcode from the App Store, open it once, then: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer")
    else
      local xv
      if ! xv="$(xcodebuild -version 2>&1)"; then
        problems+=("xcodebuild does not work yet: $(print -r -- "$xv" | head -2 | tr '\n' ' ') Open Xcode once and accept the license, or run: sudo xcodebuild -license accept")
      fi
    fi
  fi

  if (( DO_ANDROID )); then
    [[ -d "$ANDROID_SDK/platforms/android-36" ]] || problems+=("Android SDK Platform 36 is not at $ANDROID_SDK/platforms/android-36. Open Android Studio, Settings, Languages & Frameworks, Android SDK, tick Android 16 (API 36), Apply.")
    [[ -x "$STUDIO_JAVA_HOME/bin/java" ]] || problems+=("Android Studio's Java is not at $STUDIO_JAVA_HOME/bin/java. Install Android Studio in /Applications.")
    if [[ -x "$STUDIO_JAVA_HOME/bin/java" ]]; then
      local jv
      jv="$("$STUDIO_JAVA_HOME/bin/java" -version 2>&1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p' | head -1)"
      if [[ -n "$jv" ]] && (( jv < 21 )); then
        problems+=("Android Studio's Java is version $jv and the Android build needs 21. Update Android Studio (its bundled JBR is 21 or newer in current releases).")
      fi
    fi
    if [[ ! -f "$KEYSTORE" && ! -x "$STUDIO_JAVA_HOME/bin/keytool" ]]; then
      problems+=("keytool is not at $STUDIO_JAVA_HOME/bin/keytool, so the upload keystore cannot be created.")
    fi
  fi

  if [[ "$(uname -m)" != "arm64" ]]; then
    say "note: this Mac reports $(uname -m), not arm64 (Apple Silicon). The build should still work."
  fi

  if (( ${#problems} )); then
    if (( DRY )); then
      say "dry run: these would stop a real run on this machine:"
      local p
      for p in "${problems[@]}"; do say "  - $p"; done
      return 0
    fi
    print -ru2 -- ""
    print -ru2 -- "STOP: fix these first, then run the script again. Nothing was changed."
    local p
    for p in "${problems[@]}"; do print -ru2 -- "  - $p"; done
    exit 1
  fi
  say "ok: git, node $(node -v), npm$( (( DO_IOS )) && print -n ', xcodebuild' )$( (( DO_ANDROID )) && print -n ', Android SDK 36, Android Studio Java' )"
}

# ---------------------------------------------------------------------------------------------------
# 2. Repo: clone if missing, then sync r12-ready, only on a clean tree.
# ---------------------------------------------------------------------------------------------------
sync_repo() {
  step "2. Repo $REPO_DIR, branch $BRANCH"
  if [[ ! -e "$REPO_DIR/.git" ]]; then
    run mkdir -p "${REPO_DIR:h}" || fail "Could not create ${REPO_DIR:h}."
    run git clone "$REPO_URL" "$REPO_DIR" || fail "git clone failed. If GitHub asks you to sign in, sign in with the account that can read kudzie4195/holler, then run the script again."
  fi
  if (( DRY )) && [[ ! -e "$REPO_DIR/.git" ]]; then
    run git -C "$REPO_DIR" fetch origin
    run git -C "$REPO_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
    return 0
  fi
  local dirty
  dirty="$(git -C "$REPO_DIR" status --porcelain)"
  if [[ -n "$dirty" ]]; then
    print -ru2 -- ""
    print -ru2 -- "STOP: $REPO_DIR has changes that are not committed, so this script will not overwrite them:"
    print -r -- "$dirty" | head -20 >&2
    print -ru2 -- ""
    print -ru2 -- "Keep them: commit or stash them, then run the script again."
    print -ru2 -- "Throw them away: git -C \"$REPO_DIR\" checkout -- . && git -C \"$REPO_DIR\" clean -fd   then run the script again."
    exit 1
  fi
  run git -C "$REPO_DIR" fetch origin || fail "git fetch failed. Check the network and your GitHub sign-in."
  run git -C "$REPO_DIR" checkout -B "$BRANCH" "origin/$BRANCH" || fail "Could not check out $BRANCH from origin. Has the branch been pushed?"
  run git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
  say "at: $(git -C "$REPO_DIR" log -1 --format='%h %s')"
}

# ---------------------------------------------------------------------------------------------------
# 3. The public build settings. Never overwrites an existing file.
# ---------------------------------------------------------------------------------------------------
write_env() {
  step "3. Build settings"
  local env_file="$REPO_DIR/mobile/.env.production.local"
  if [[ -e "$env_file" ]]; then
    say "Using the existing $env_file (not overwritten). Feature flags in it:"
    grep -E '^VITE_(APPLE_SIGN_IN|GOOGLE_SIGN_IN|PUSH_ENABLED|IOS_EXTERNAL_PURCHASE_LINK)=' "$env_file" | sed 's/^/  /' || true
    return 0
  fi
  say "No $env_file yet. Writing the public values for the first test build (ignored by git)."
  if (( DRY )); then
    say "+ write $env_file with VITE_API_BASE, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (public), empty RevenueCat keys, all four flags false"
    return 0
  fi
  cat > "$env_file" <<'EOF'
VITE_API_BASE=https://localholler.com
VITE_SUPABASE_URL=https://ksctghdtklufgxblueqp.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzY3RnaGR0a2x1Zmd4Ymx1ZXFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MTcyMzcsImV4cCI6MjA5MjE5MzIzN30.NyxXwMYckzFMXqlpeRY0NXf0f5Pj1BSXVcNgWJoN594
VITE_REVENUECAT_IOS_KEY=
VITE_REVENUECAT_ANDROID_KEY=
VITE_APPLE_SIGN_IN=false
VITE_GOOGLE_SIGN_IN=false
VITE_PUSH_ENABLED=false
VITE_IOS_EXTERNAL_PURCHASE_LINK=false
EOF
  say "wrote $env_file"
}

# ---------------------------------------------------------------------------------------------------
# 4. Web build and sync into both native projects.
# ---------------------------------------------------------------------------------------------------
build_web() {
  step "4. Web build and sync"
  local log="$OUT/web.log"
  if (( DRY )); then say "+ cd ${REPO_DIR}/mobile"; else cd "$REPO_DIR/mobile"; fi
  run_logged "$log" npm ci || fail "npm ci failed. Log: $log"
  run_logged "$log" npm test || fail "npm test failed. Log: $log"
  run_logged "$log" npm run build || fail "npm run build failed. Log: $log"
  run_logged "$log" npm run check:version || fail "Version parity check failed. Log: $log"
  run_logged "$log" npx cap sync || fail "npx cap sync failed. Log: $log"
  run_logged "$log" npm run check:sync || fail "The synced web assets do not match dist/. Log: $log"
  run_logged "$log" npm run check:dist || fail "The built bundle loads a native plugin at start-up. Log: $log"
}

# ---------------------------------------------------------------------------------------------------
# 5. iOS: archive, then export with destination upload (sends the build to App Store Connect).
# ---------------------------------------------------------------------------------------------------
ios_errors() {
  local log="$1"
  say ""
  say "First errors in $log:"
  { grep -E 'error:|Error Domain|\*\* (ARCHIVE|EXPORT) FAILED' "$log" | head -15; } || true
  if grep -qiE 'No Accounts|no account for team|Failed to find a suitable' "$log" 2>/dev/null; then
    say "Hint: open Xcode, Settings, Accounts, and sign in with the Apple ID that belongs to team $TEAM_ID. Then run the script again."
  fi
  if grep -qiE 'already been uploaded|must be higher|bundle version' "$log" 2>/dev/null; then
    say "Hint: App Store Connect already has this build number. Raise CURRENT_PROJECT_VERSION in Xcode (target App, General, Build) and versionCode in android/app/build.gradle, commit, push, run again."
  fi
}

ios_phase() {
  step "5. iOS: archive and upload to App Store Connect"
  local project="$REPO_DIR/mobile/ios/App/App.xcodeproj"
  local archive="$OUT/Holler.xcarchive"
  local export_dir="$OUT/ios-export"
  local plist="$OUT/ExportOptions.plist"
  local log="$OUT/ios.log"

  if (( DRY )); then
    say "+ write $plist (method app-store-connect, destination upload, teamID $TEAM_ID, signingStyle automatic, uploadSymbols true, manageAppVersionAndBuildNumber false)"
  else
    cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>upload</string>
  <key>teamID</key>
  <string>$TEAM_ID</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>uploadSymbols</key>
  <true/>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
</dict>
</plist>
EOF
    if command -v plutil >/dev/null 2>&1; then
      plutil -lint "$plist" >/dev/null || { say "ExportOptions.plist is not valid."; return 1; }
    fi
    if ! xcodebuild -list -project "$project" 2>&1 | grep -qE '^[[:space:]]+App$'; then
      say "xcodebuild does not list a scheme named App for $project."
      return 1
    fi
  fi

  say "Archiving. This takes several minutes the first time (Swift packages download). Full log: $log"
  run_quiet "$log" xcodebuild -project "$project" -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath "$archive" -allowProvisioningUpdates archive || { say "iOS archive FAILED."; (( DRY )) || ios_errors "$log"; return 1; }

  say "Exporting and uploading to App Store Connect, using the Apple account signed in to Xcode."
  run_quiet "$log" xcodebuild -exportArchive -archivePath "$archive" -exportPath "$export_dir" -exportOptionsPlist "$plist" -allowProvisioningUpdates || { say "iOS export or upload FAILED."; (( DRY )) || ios_errors "$log"; return 1; }
  (( DRY )) && return 0
  say "iOS upload finished. The build shows under TestFlight in App Store Connect after processing (often 10 to 30 minutes)."
}

# ---------------------------------------------------------------------------------------------------
# 6. Android: keystore if missing, then a signed AAB. The password is typed once and never stored.
# ---------------------------------------------------------------------------------------------------
android_phase() {
  step "6. Android: signed AAB"
  local android_dir="$REPO_DIR/mobile/android"
  local aab="$android_dir/app/build/outputs/bundle/release/app-release.aab"
  local log="$OUT/android.log"
  local keytool="$STUDIO_JAVA_HOME/bin/keytool"

  if [[ ! -f "$KEYSTORE" ]]; then
    say "There is no upload keystore at $KEYSTORE, so one is created now."
    say "keytool will ask for a password twice (choose one and remember it: you type it again in a moment) and for some name fields."
    say "YOU TYPE THE PASSWORD HERE. Nothing is saved by this script."
    run mkdir -p "$HOME/keys" || return 1
    run "$keytool" -genkeypair -v -storetype PKCS12 -keystore "$KEYSTORE" -alias "$KEY_ALIAS" -keyalg RSA -keysize 2048 -validity 10950 || { say "keytool failed."; return 1; }
    run chmod 600 "$KEYSTORE" || return 1
    say "Back up $KEYSTORE and its password now (for example to an encrypted drive). Losing them means asking Google for a key reset."
  fi

  local pw=""
  if (( DRY )); then
    say "+ read -s   (prompt: Type the Holler upload key password; the value is never printed or written)"
    pw="dry-run-not-a-password"
  else
    read -rs "pw?Type the Holler upload key password: " || { say "No password was read."; return 1; }
    print ""
    if [[ -z "$pw" ]]; then say "The password was empty."; return 1; fi
    if ! HOLLER_KS_CHECK="$pw" "$keytool" -list -keystore "$KEYSTORE" -alias "$KEY_ALIAS" -storepass:env HOLLER_KS_CHECK >/dev/null 2>&1; then
      say "That password does not open $KEYSTORE (alias $KEY_ALIAS). Run the script again and retype it."
      pw=""
      return 1
    fi
  fi

  run rm -f "$aab" || return 1
  say "Building the release bundle. The first run downloads Gradle and the Android libraries. Full log: $log"
  if (( DRY )); then
    say "+ cd ${(q)android_dir} && ORG_GRADLE_PROJECT_HOLLER_UPLOAD_STORE_FILE=${(q)KEYSTORE} ORG_GRADLE_PROJECT_HOLLER_UPLOAD_STORE_PASSWORD=<hidden> ORG_GRADLE_PROJECT_HOLLER_UPLOAD_KEY_ALIAS=${(q)KEY_ALIAS} ORG_GRADLE_PROJECT_HOLLER_UPLOAD_KEY_PASSWORD=<hidden> JAVA_HOME=${(q)STUDIO_JAVA_HOME} ANDROID_HOME=${(q)ANDROID_SDK} ./gradlew :app:bundleRelease --no-daemon >> ${(q)log} 2>&1"
  else
    # The four values exist only in this one command's environment (--no-daemon: no Gradle process keeps them afterwards).
    if ! ( cd "$android_dir" && \
      ORG_GRADLE_PROJECT_HOLLER_UPLOAD_STORE_FILE="$KEYSTORE" \
      ORG_GRADLE_PROJECT_HOLLER_UPLOAD_STORE_PASSWORD="$pw" \
      ORG_GRADLE_PROJECT_HOLLER_UPLOAD_KEY_ALIAS="$KEY_ALIAS" \
      ORG_GRADLE_PROJECT_HOLLER_UPLOAD_KEY_PASSWORD="$pw" \
      JAVA_HOME="$STUDIO_JAVA_HOME" \
      ANDROID_HOME="$ANDROID_SDK" \
      ./gradlew :app:bundleRelease --no-daemon >> "$log" 2>&1 ); then
      pw=""
      say "Android build FAILED. First errors in $log:"
      { grep -E -A4 'What went wrong' "$log" | head -20; } || true
      if grep -qiE 'SDK location not found' "$log" 2>/dev/null; then
        say "Hint: the Android SDK was not found at $ANDROID_SDK."
      fi
      if grep -qiE 'licen[cs]e' "$log" 2>/dev/null; then
        say "Hint: accept the Android SDK licenses: \"$ANDROID_SDK/cmdline-tools/latest/bin/sdkmanager\" --licenses"
      fi
      return 1
    fi
    pw=""
  fi

  local vname="1.0.0" vcode="1"
  if [[ -f "$android_dir/app/build.gradle" ]]; then
    vname="$(sed -n 's/.*versionName "\([^"]*\)".*/\1/p' "$android_dir/app/build.gradle" | head -1)"
    vcode="$(sed -n 's/^[[:space:]]*versionCode \([0-9][0-9]*\).*/\1/p' "$android_dir/app/build.gradle" | head -1)"
  fi
  local dest="$OUT/holler-${vname}-${vcode}.aab"
  if (( DRY )); then
    say "+ cp $aab $dest"
    say "+ shasum -a 256 $dest"
    say "+ $STUDIO_JAVA_HOME/bin/jarsigner -verify <aab>   (expects: jar verified.)"
    return 0
  fi
  [[ -f "$aab" ]] || { say "Gradle finished but $aab is not there."; return 1; }
  cp "$aab" "$dest" || return 1
  say "AAB: $dest"
  say "sha256: $(shasum -a 256 "$dest" | cut -d' ' -f1)"
  if [[ -x "$STUDIO_JAVA_HOME/bin/jarsigner" ]]; then
    say "signature check: $("$STUDIO_JAVA_HOME/bin/jarsigner" -verify "$dest" 2>&1 | tail -1)"
  fi
  AAB_PATH="$dest"
}

# ---------------------------------------------------------------------------------------------------
main() {
  AAB_PATH=""
  local ios_status="skipped" android_status="skipped"

  say "Holler release: $( (( DRY )) && print -n 'DRY RUN, ' )iOS $( (( DO_IOS )) && print -n yes || print -n no ), Android $( (( DO_ANDROID )) && print -n yes || print -n no )"
  say "Output folder: $OUT"

  check_prereqs
  sync_repo
  write_env
  run mkdir -p "$OUT" || fail "Could not create $OUT."
  build_web

  # Each phase runs in an "if", so a failure in one never stops the other.
  if (( DO_IOS )); then
    if ios_phase; then ios_status="ok"; else ios_status="FAILED"; fi
    (( DRY )) && ios_status="dry run (not run)"
  fi
  if (( DO_ANDROID )); then
    if android_phase; then android_status="ok"; else android_status="FAILED"; fi
    (( DRY )) && android_status="dry run (not run)"
  fi

  step "Summary"
  if (( DRY )); then
    say "dry run: nothing was run, written or uploaded."
  fi
  say "iOS upload:  $ios_status"
  if [[ -n "$AAB_PATH" ]]; then
    say "Android AAB: $android_status, $AAB_PATH"
  else
    say "Android AAB: $android_status"
  fi
  say "Logs and files: $OUT"
  if [[ "$ios_status" == "FAILED" || "$android_status" == "FAILED" ]]; then
    return 1
  fi
  return 0
}

main "$@"; exit $?
