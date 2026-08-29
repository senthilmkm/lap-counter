const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY: These patches run automatically via the "postinstall" npm script
// hook whenever `npm install` or `npm ci` runs — including when EAS local
// build runs `npm install` internally before `pod install`.
//
// We DELETE the problematic Package.swift files entirely instead of patching
// them, because deletion is idempotent and survives any file-watching or
// re-read by Xcode's SPM resolver. CocoaPods-based Expo/EAS builds do NOT
// use these SPM packages — CocoaPods handles all dependencies separately.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 1. Remove react-native ReactNativeDependencies/Package.swift
//
//    react-native 0.86 ships a Package.swift that references a LOCAL binary
//    xcframework at "../../third-party/ReactNativeDependencies.xcframework".
//    That file does NOT exist in the npm release (only in Meta's monorepo).
//    Xcode's SPM resolver picks this up and immediately fails.
//
//    Safe to delete: CocoaPods handles ReactNativeDependencies via its own
//    podspec. This SPM package is unused in Expo/EAS CocoaPods builds.
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
//
//    This package uses swift-syntax from "602.0.0-latest" — a Swift 6.2
//    nightly tag that doesn't exist in the public registry and cannot be
//    resolved by Xcode 16.1 (Swift 6.0). Replace with stable "509.0.0".
//
//    We cannot delete this one because the macros plugin IS used (it defines
//    Swift macros). We must keep it but with a resolvable version.
// ─────────────────────────────────────────────────────────────────────────────
const macroPackageSwift = path.join(
  __dirname, '..', 'node_modules', '@expo', 'expo-modules-macros-plugin', 'apple', 'Package.swift'
);
if (fs.existsSync(macroPackageSwift)) {
  let content = fs.readFileSync(macroPackageSwift, 'utf8');
  let changed = false;

  // Replace nightly swift-syntax tag with latest stable
  const p1 = content.replace(/from:\s*"602\.0\.0-latest"/g, 'from: "509.0.0"');
  if (p1 !== content) { content = p1; changed = true; }

  // Downgrade swift-tools-version if it's beyond 6.0 (Xcode 16.1 = Swift 6.0)
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
// 3. Remove expo-modules-jsi Package.swift  (if it exists)
//
//    expo-modules-jsi's Package.swift uses experimental Swift features
//    (NonescapableTypes, bare-slash regex) that require Swift 6 language mode.
//    When built via CocoaPods, the podspec handles compilation correctly.
//    The SPM Package.swift is only needed for Meta's SPM-first workflow.
// ─────────────────────────────────────────────────────────────────────────────
const jsiPackageSwift = path.join(
  __dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Package.swift'
);
if (fs.existsSync(jsiPackageSwift)) {
  fs.rmSync(jsiPackageSwift);
  console.log('✅ Removed expo-modules-jsi/apple/Package.swift');
} else {
  console.log('✔  expo-modules-jsi/apple/Package.swift already removed');
}

console.log('✅ Postinstall completed successfully');
