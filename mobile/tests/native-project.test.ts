// R12 READY: the store-facing settings of both native projects, locked so a later `cap sync` or Xcode
// edit cannot quietly change them. Reads the project files as text; nothing here needs a Mac or an SDK.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

/** PNG colour type from the IHDR chunk, and whether a tRNS (transparency) chunk exists. */
function pngInfo(p: string) {
  const b = readFileSync(path.join(root, p));
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25], hasTrns: b.includes(Buffer.from('tRNS')) };
}

describe('iOS project', () => {
  const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
  const plist = read('ios/App/App/Info.plist');
  const targetSettings = (name: 'Debug' | 'Release') => {
    const blocks = [...pbx.matchAll(/buildSettings = \{([\s\S]*?)\n\t\t\t\};\n\t\t\tname = (Debug|Release);/g)].filter((m) => m[2] === name);
    return blocks.find((m) => m[1].includes('PRODUCT_BUNDLE_IDENTIFIER'))![1];
  };

  for (const cfg of ['Debug', 'Release'] as const) {
    it(`${cfg}: bundle id, team, automatic signing, iPhone only, iOS 15, version 1.0.0 (1)`, () => {
      const s = targetSettings(cfg);
      expect(s).toMatch(/PRODUCT_BUNDLE_IDENTIFIER = com\.localholler\.app;/);
      expect(s).toMatch(/DEVELOPMENT_TEAM = B3B65JKTQ7;/);
      expect(s).toMatch(/CODE_SIGN_STYLE = Automatic;/);
      expect(s).toMatch(/TARGETED_DEVICE_FAMILY = 1;/);
      expect(s).toMatch(/IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/);
      expect(s).toMatch(/MARKETING_VERSION = 1\.0\.0;/);
      expect(s).toMatch(/CURRENT_PROJECT_VERSION = 1;/);
      expect(s).toMatch(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/);
    });
  }

  it('portrait only, no iPad orientations, no export-compliance question', () => {
    const orient = plist.slice(plist.indexOf('UISupportedInterfaceOrientations'), plist.indexOf('UIViewControllerBasedStatusBarAppearance'));
    expect(orient).toContain('UIInterfaceOrientationPortrait');
    expect(orient).not.toMatch(/Landscape|PortraitUpsideDown/);
    expect(plist).not.toContain('UISupportedInterfaceOrientations~ipad');
    expect(plist).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  });

  it('asks for no permission that needs a usage-description string', () => {
    // Push and Sign in with Apple need no NS*UsageDescription. If code ever asks for one of these, add the key first.
    const needsUsageText = /geolocation|getUserMedia|capacitor\/(camera|geolocation|contacts|filesystem|media)|type="file"|navigator\.(mediaDevices|contacts)/;
    const src = walk(path.join(root, 'src'));
    for (const f of src) expect(readFileSync(f, 'utf8'), f).not.toMatch(needsUsageText);
    const pkg = JSON.parse(read('package.json')).dependencies as Record<string, string>;
    expect(Object.keys(pkg).filter((n) => /camera|geolocation|contacts|filesystem|media|speech|bluetooth/.test(n))).toEqual([]);
    expect(plist).not.toMatch(/UsageDescription/);
  });

  it('privacy manifest covers UserDefaults (Capacitor Preferences) with reason CA92.1, no tracking', () => {
    const m = read('ios/App/App/PrivacyInfo.xcprivacy');
    expect(m).toMatch(/NSPrivacyAccessedAPICategoryUserDefaults<\/string>\s*<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>\s*<string>CA92\.1<\/string>/);
    expect(m).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  });

  it('entitlements: aps-environment and Sign in with Apple stay (the App ID carries both capabilities)', () => {
    const e = read('ios/App/App/App.entitlements');
    expect(e).toContain('aps-environment');
    expect(e).toContain('com.apple.developer.applesignin');
  });

  it('AppDelegate never calls FirebaseApp.configure() (the plugin does it only when GoogleService-Info.plist exists)', () => {
    const d = read('ios/App/App/AppDelegate.swift');
    expect(d).not.toMatch(/FirebaseApp\.configure|import Firebase/);
    expect(existsSync(path.join(root, 'ios/App/App/GoogleService-Info.plist'))).toBe(false);
  });

  it('requires arm64 (the binary is arm64 only), not armv7', () => {
    expect(plist).toMatch(/<key>UIRequiredDeviceCapabilities<\/key>\s*<array>\s*<string>arm64<\/string>\s*<\/array>/);
  });

  it('a shared App scheme is committed: Archive uses Release and the target id exists in project.pbxproj', () => {
    const scheme = read('ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme');
    expect(scheme).toMatch(/<ArchiveAction\s+buildConfiguration = "Release"/);
    for (const a of ['BuildAction', 'TestAction', 'LaunchAction', 'ProfileAction', 'AnalyzeAction']) expect(scheme).toContain(`<${a}`);
    expect(scheme).toContain('BuildableName = "App.app"');
    expect(scheme).toContain('BlueprintName = "App"');
    expect(scheme).toContain('ReferencedContainer = "container:App.xcodeproj"');
    const ids = [...scheme.matchAll(/BlueprintIdentifier = "([0-9A-F]{24})"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(pbx).toMatch(new RegExp(`\\t\\t${id} /\\* App \\*/ = \\{\\n\\t\\t\\tisa = PBXNativeTarget;`));
  });

  it('the AppIcon is one 1024 px PNG with no alpha channel and no transparency chunk', () => {
    const icon = pngInfo('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
    expect(icon.width).toBe(1024);
    expect(icon.height).toBe(1024);
    expect([0, 2]).toContain(icon.colorType); // greyscale or RGB; 4 and 6 carry alpha
    expect(icon.hasTrns).toBe(false);
  });
});

describe('Android project', () => {
  const gradle = read('android/app/build.gradle');
  const vars = read('android/variables.gradle');
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  it('application id, SDK levels, version', () => {
    expect(gradle).toMatch(/applicationId "com\.localholler\.app"/);
    expect(gradle).toMatch(/namespace = "com\.localholler\.app"/);
    expect(gradle).toMatch(/versionCode 1\b/);
    expect(gradle).toMatch(/versionName "1\.0\.0"/);
    expect(vars).toMatch(/minSdkVersion = 24\b/);
    expect(vars).toMatch(/compileSdkVersion = 36\b/);
    expect(vars).toMatch(/targetSdkVersion = 36\b/);
  });

  it('release signing reads the four HOLLER_UPLOAD_* properties and stops a release build without them', () => {
    const signing = read('android/app/holler-signing.gradle');
    for (const n of ['HOLLER_UPLOAD_STORE_FILE', 'HOLLER_UPLOAD_STORE_PASSWORD', 'HOLLER_UPLOAD_KEY_ALIAS', 'HOLLER_UPLOAD_KEY_PASSWORD']) {
      expect(signing).toContain(`'${n}'`);
    }
    expect(gradle).toMatch(/storeFile hollerUploadStoreFile\(\)/);
    for (const n of ['HOLLER_UPLOAD_STORE_PASSWORD', 'HOLLER_UPLOAD_KEY_ALIAS', 'HOLLER_UPLOAD_KEY_PASSWORD']) expect(gradle).toContain(n);
    expect(signing).toMatch(/throw new GradleException/);
    expect(gradle).toMatch(/signingConfig signingConfigs\.release/);
  });

  it('release is not debuggable; minify is off, so no Capacitor keep rules are needed', () => {
    expect(manifest).not.toMatch(/android:debuggable/);
    expect(gradle).not.toMatch(/debuggable\s+true/);
    expect(gradle).toMatch(/release \{[\s\S]*?minifyEnabled false/);
  });

  it('the Google services plugin is applied only when google-services.json has content', () => {
    expect(gradle).toMatch(/def servicesJSON = file\('google-services\.json'\)\s*if \(servicesJSON\.text\) \{\s*apply plugin: 'com\.google\.gms\.google-services'/);
    expect(gradle).toMatch(/\} catch\(Exception e\)/);
    expect(existsSync(path.join(root, 'android/app/google-services.json'))).toBe(false);
  });

  it('adaptive launcher icons exist in every density plus the anydpi-v26 definition', () => {
    for (const d of ['ldpi', 'mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      for (const f of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground', 'ic_launcher_background']) {
        expect(existsSync(path.join(root, `android/app/src/main/res/mipmap-${d}/${f}.png`)), `${d}/${f}`).toBe(true);
      }
    }
    for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) expect(existsSync(path.join(root, `android/app/src/main/res/mipmap-anydpi-v26/${f}`))).toBe(true);
  });

  it('build-tool files that the release script must not trip over are git-ignored (.kotlin/)', () => {
    expect(read('android/.gitignore')).toMatch(/^\.kotlin\/$/m);
    expect(read('ios/.gitignore')).toMatch(/^App\/App\.xcodeproj\/project\.xcworkspace\/xcshareddata\/swiftpm\/$/m);
  });

  it('release builds refuse cleartext and keep the app portrait', () => {
    expect(manifest).toMatch(/android:usesCleartextTraffic="false"/);
    expect(manifest).toMatch(/android:screenOrientation="portrait"/);
  });
});
