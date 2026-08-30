const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// This script runs automatically via the npm "postinstall" hook whenever
// `npm install` or `npm ci` runs — including inside EAS local builds.
//
// We fix SwiftPM compatibility issues that cause Xcode 16 to fail:
//
// 1. react-native ReactNativeDependencies/Package.swift:
//    References a non-existent local file "../../third-party/ReactNativeDependencies.xcframework".
//    Delete it (CocoaPods manages this dependency independently).
//
// 2. @expo/expo-modules-macros-plugin Package.swift:
//    References unreleased nightly "602.0.0-latest" swift-syntax.
//    Patch it to stable "509.0.0" and swift-tools-version 6.0.
//
// 3. expo-modules-jsi Package.swift:
//    Specifies "swift-tools-version: 6.2" and experimental features that Xcode 16.0/16.1/16.2
//    (which use Swift 6.0) cannot parse during SPM resolution.
//    Patch it to "swift-tools-version: 6.0" and remove upcoming features.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// 1. Delete react-native/Libraries/ReactNativeDependencies/Package.swift
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
    console.log('✅ Patched @expo/expo-modules-macros-plugin Package.swift (swift-syntax 509.0.0, tools 6.0)');
  } else {
    console.log('✔  @expo/expo-modules-macros-plugin Package.swift already up-to-date');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Patch expo-modules-jsi/apple/Package.swift
// ─────────────────────────────────────────────────────────────────────────────
const jsiPackageSwift = path.join(
  __dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Package.swift'
);
if (fs.existsSync(jsiPackageSwift)) {
  let content = fs.readFileSync(jsiPackageSwift, 'utf8');
  let changed = false;

  // Change swift-tools-version 6.2 -> 6.0
  const p1 = content.replace(/\/\/ swift-tools-version:\s*6\.[1-9]/g, '// swift-tools-version: 6.0');
  if (p1 !== content) { content = p1; changed = true; }

  // Remove experimental/upcoming Swift 6.2 features that Xcode 16 (Swift 6.0) doesn't support
  const p2 = content
    .replace(/\.enableUpcomingFeature\("NonisolatedNonsendingByDefault"\),?/g, '')
    .replace(/\.enableUpcomingFeature\("InferIsolatedConformances"\),?/g, '');
  if (p2 !== content) { content = p2; changed = true; }

  if (changed) {
    fs.writeFileSync(jsiPackageSwift, content, 'utf8');
    console.log('✅ Patched expo-modules-jsi/apple/Package.swift (swift-tools-version 6.0)');
  } else {
    console.log('✔  expo-modules-jsi/apple/Package.swift already up-to-date');
  }
} else {
  console.log('⚠️  expo-modules-jsi/apple/Package.swift not found');
}

console.log('✅ Postinstall completed successfully');
