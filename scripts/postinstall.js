const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// This script runs automatically via the npm "postinstall" hook whenever
// `npm install` or `npm ci` runs — including inside EAS local builds.
//
// PROBLEM: expo-modules-jsi/apple/Package.swift is found by Xcode's SPM
// resolver and causes "Could not resolve package dependencies" failures.
// The file uses experimental Swift 6 features that confuse the resolver.
//
// SOLUTION:
//   1. Delete Package.swift  → Xcode's SPM resolver can't see it.
//   2. Patch build-xcframework.sh → exit 0 when Package.swift is absent,
//      relying on the prebuilt ExpoModulesJSI.xcframework that Expo's
//      CocoaPods plugin places during pod install via:
//      "[Expo] Ensuring required slices in ExpoModulesJSI.xcframework"
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 1. Delete react-native/Libraries/ReactNativeDependencies/Package.swift
//
//    react-native 0.86 ships a Package.swift referencing a LOCAL xcframework
//    at "../../third-party/ReactNativeDependencies.xcframework" that does NOT
//    exist in the npm release. CocoaPods handles this dependency separately.
// ─────────────────────────────────────────────────────────────────────────────
const rnDepsPackageSwift = path.join(
  __dirname, '..', 'node_modules', 'react-native',
  'Libraries', 'ReactNativeDependencies', 'Package.swift'
);
if (fs.existsSync(rnDepsPackageSwift)) {
  fs.rmSync(rnDepsPackageSwift);
  console.log('✅ Removed react-native/Libraries/ReactNativeDependencies/Package.swift');
} else {
  console.log('✔  react-native ReactNativeDependencies/Package.swift already removed');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Patch @expo/expo-modules-macros-plugin Package.swift
//    Replace "602.0.0-latest" (nightly swift-syntax) with stable "509.0.0"
// ─────────────────────────────────────────────────────────────────────────────
const macroPackageSwift = path.join(
  __dirname, '..', 'node_modules', '@expo', 'expo-modules-macros-plugin', 'apple', 'Package.swift'
);
if (fs.existsSync(macroPackageSwift)) {
  let content = fs.readFileSync(macroPackageSwift, 'utf8');
  let changed = false;

  const p1 = content.replace(/from:\s*"602\.0\.0-latest"/g, 'from: "509.0.0"');
  if (p1 !== content) { content = p1; changed = true; }

  const p2 = content.replace(/\/\/ swift-tools-version:\s*6\.[1-9]/g, '// swift-tools-version: 6.0');
  if (p2 !== content) { content = p2; changed = true; }

  if (changed) {
    fs.writeFileSync(macroPackageSwift, content, 'utf8');
    console.log('✅ Patched @expo/expo-modules-macros-plugin Package.swift (swift-syntax 509.0.0)');
  } else {
    console.log('✔  @expo/expo-modules-macros-plugin Package.swift already up-to-date');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Delete expo-modules-jsi/apple/Package.swift
//
//    This file uses experimental Swift 6 features (.interoperabilityMode(.Cxx),
//    .enableExperimentalFeature("NonescapableTypes")) that cause Xcode's SPM
//    resolver to fail with "Could not resolve package dependencies".
//
//    The ExpoModulesJSI.xcframework is provided as a prebuilt binary by Expo's
//    CocoaPods plugin ("[Expo] Ensuring required slices in ExpoModulesJSI.xcframework"),
//    so we don't need to build it from source.
// ─────────────────────────────────────────────────────────────────────────────
const jsiPackageSwift = path.join(
  __dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Package.swift'
);
if (fs.existsSync(jsiPackageSwift)) {
  fs.rmSync(jsiPackageSwift);
  console.log('✅ Removed expo-modules-jsi/apple/Package.swift (SPM resolution fix)');
} else {
  console.log('✔  expo-modules-jsi/apple/Package.swift already removed');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Patch expo-modules-jsi/apple/scripts/build-xcframework.sh
//
//    The ExpoModulesJSI pod has a build phase "Build ExpoModulesJSI xcframework"
//    that runs build-xcframework.sh. This script calls:
//      xcodebuild build -scheme ExpoModulesJSI
//    which requires Package.swift to exist. Since we deleted it, the build
//    phase would fail with "does not contain an Xcode project, workspace or package".
//
//    FIX: Inject an early-exit guard at the top of the script. When Package.swift
//    is absent, exit 0 immediately. Expo's prebuilt xcframework (placed during
//    pod install) is used instead of building from source.
// ─────────────────────────────────────────────────────────────────────────────
const buildScriptPath = path.join(
  __dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'scripts', 'build-xcframework.sh'
);
const PATCH_MARKER = '# [PATCHED-BY-POSTINSTALL]';

if (fs.existsSync(buildScriptPath)) {
  let script = fs.readFileSync(buildScriptPath, 'utf8');

  if (!script.includes(PATCH_MARKER)) {
    // Insert the guard right after "set -euo pipefail" (line 26)
    const earlyExit = `
${PATCH_MARKER}
# If Package.swift was removed for SPM resolver compatibility, skip source build.
# Expo's CocoaPods plugin ("[Expo] Ensuring required slices") has already placed
# a prebuilt ExpoModulesJSI.xcframework. We use that instead of rebuilding.
_EARLY_PACKAGE_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "\${_EARLY_PACKAGE_DIR}/Package.swift" ]]; then
  echo "[ExpoModulesJSI] Package.swift absent — using Expo prebuilt xcframework (SPM compat patch)"
  exit 0
fi
unset _EARLY_PACKAGE_DIR
# [/PATCHED-BY-POSTINSTALL]

`;
    script = script.replace('set -euo pipefail', 'set -euo pipefail\n' + earlyExit);
    fs.writeFileSync(buildScriptPath, script, 'utf8');
    console.log('✅ Patched build-xcframework.sh (early-exit when Package.swift absent)');
  } else {
    console.log('✔  build-xcframework.sh already patched');
  }
} else {
  console.log('⚠️  build-xcframework.sh not found — skipping patch');
}

console.log('✅ Postinstall completed successfully');
