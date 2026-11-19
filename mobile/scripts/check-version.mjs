// Version parity: package.json version = iOS MARKETING_VERSION = Android versionName.
// Prints the build numbers too, so the person uploading can see what to bump. Exit 1 on a mismatch.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

export function readVersions(files = { pkg: read('package.json'), pbx: read('ios/App/App.xcodeproj/project.pbxproj'), gradle: read('android/app/build.gradle') }) {
  const marketing = [...files.pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1].trim());
  const builds = [...files.pbx.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1].trim());
  return {
    pkg: JSON.parse(files.pkg).version,
    marketing,
    iosBuild: builds,
    versionName: /versionName\s+"([^"]+)"/.exec(files.gradle)?.[1] ?? null,
    versionCode: /versionCode\s+(\d+)/.exec(files.gradle)?.[1] ?? null,
  };
}

export function parityProblems(v) {
  const problems = [];
  if (!v.marketing.length || v.marketing.some((m) => m !== v.pkg)) problems.push(`iOS MARKETING_VERSION ${v.marketing.join('/')} is not package.json ${v.pkg}`);
  if (new Set(v.iosBuild).size > 1) problems.push(`iOS Debug and Release builds differ: ${v.iosBuild.join('/')}`);
  if (v.versionName !== v.pkg) problems.push(`Android versionName ${v.versionName} is not package.json ${v.pkg}`);
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const v = readVersions();
  const problems = parityProblems(v);
  console.log(`version ${v.pkg} | iOS ${v.marketing[0]} (build ${v.iosBuild[0]}) | Android ${v.versionName} (versionCode ${v.versionCode})`);
  if (problems.length) {
    for (const p of problems) console.error(`check-version: ${p}`);
    process.exit(1);
  }
}
