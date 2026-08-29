const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Patch @expo/expo-modules-macros-plugin Package.swift
//    Replaces the Swift 6.2 nightly swift-syntax tag (602.0.0-latest) that
//    doesn't exist in the public registry with a stable release compatible
//    with Xcode 16.1 (Swift 6.0).
// ─────────────────────────────────────────────────────────────────────────────
const macroPackageSwift = path.join(
  __dirname, '..', 'node_modules', '@expo', 'expo-modules-macros-plugin', 'apple', 'Package.swift'
);
if (fs.existsSync(macroPackageSwift)) {
  let content = fs.readFileSync(macroPackageSwift, 'utf8');
  let changed = false;

  const patched1 = content.replace(/from:\s*"602\.0\.0-latest"/g, 'from: "509.0.0"');
  if (patched1 !== content) { content = patched1; changed = true; }

  const patched2 = content.replace(/swift-tools-version:\s*6\.[1-9]/g, 'swift-tools-version: 6.0');
  if (patched2 !== content) { content = patched2; changed = true; }

  if (changed) {
    fs.writeFileSync(macroPackageSwift, content, 'utf8');
    console.log('✅ Patched @expo/expo-modules-macros-plugin Package.swift (swift-syntax version)');
  } else {
    console.log('✔  @expo/expo-modules-macros-plugin Package.swift already up-to-date');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Neutralize react-native ReactNativeDependencies Package.swift
//
//    react-native 0.86 ships a Package.swift that references a LOCAL binary
//    xcframework at a relative path ("../../third-party/ReactNativeDependencies.xcframework").
//    That file is NOT included in the npm package — it only exists inside Meta's
//    internal monorepo. When Xcode's SPM resolver encounters this package it
//    immediately fails with "Could not resolve package dependencies".
//
//    The CocoaPods-based Expo/EAS build does NOT need this SPM package at all
//    (CocoaPods handles ReactNativeDependencies separately via its own podspec).
//    We replace the broken binaryTarget with an empty sources target so that
//    SPM resolution succeeds without requiring the missing xcframework.
// ─────────────────────────────────────────────────────────────────────────────
const rnDepsPackageSwift = path.join(
  __dirname, '..', 'node_modules', 'react-native',
  'Libraries', 'ReactNativeDependencies', 'Package.swift'
);
if (fs.existsSync(rnDepsPackageSwift)) {
  const originalContent = fs.readFileSync(rnDepsPackageSwift, 'utf8');

  // Only patch if it still contains the broken local binaryTarget reference
  if (originalContent.includes('../../third-party/ReactNativeDependencies.xcframework')) {
    const patchedContent = `// swift-tools-version: 6.0
// Patched by postinstall.js — the original binaryTarget references a local
// xcframework that only exists in Meta's monorepo, not in the npm release.
// The CocoaPods-based Expo/EAS build manages ReactNativeDependencies via
// its own podspec and does NOT use this SPM package.

import PackageDescription

let package = Package(
  name: "ReactNativeDependencies",
  products: [
    .library(
      name: "ReactNativeDependencies",
      targets: ["ReactNativeDependencies"]
    )
  ],
  targets: [
    .target(
      name: "ReactNativeDependencies",
      path: "Sources"
    )
  ]
)
`;
    // Ensure the Sources stub directory exists so SPM doesn't complain
    const sourcesDir = path.join(
      __dirname, '..', 'node_modules', 'react-native',
      'Libraries', 'ReactNativeDependencies', 'Sources'
    );
    if (!fs.existsSync(sourcesDir)) {
      fs.mkdirSync(sourcesDir, { recursive: true });
      // A Swift target must contain at least one Swift file
      fs.writeFileSync(
        path.join(sourcesDir, 'Stub.swift'),
        '// Stub — this target is intentionally empty.\n',
        'utf8'
      );
    }

    fs.writeFileSync(rnDepsPackageSwift, patchedContent, 'utf8');
    console.log('✅ Neutralized react-native ReactNativeDependencies Package.swift (missing xcframework)');
  } else {
    console.log('✔  react-native ReactNativeDependencies Package.swift already patched');
  }
}

console.log('✅ Postinstall completed successfully');
