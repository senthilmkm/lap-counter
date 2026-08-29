const fs = require('fs');
const path = require('path');

// 1. Completely rewrite ExpoModulesJSI Package.swift with 100% valid Swift 6.0 syntax (zero trailing commas)
const cleanExpoModulesJSIPackageSwift = `// swift-tools-version: 6.0
// The swift-tools-version declares the minimum version of Swift required to build this package.

import Foundation
import PackageDescription

let packageDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().path
let podsRoot = resolvePodsRoot()

let publicHeaders = "\\(podsRoot)/Headers/Public"
let reactNative =
  ProcessInfo.processInfo.environment["RN_ROOT"]
  ?? ProcessInfo.processInfo.environment["REACT_NATIVE_PATH"]
  ?? "\\(podsRoot)/../../node_modules/react-native"
let headerSearchPaths = [
  publicHeaders,
  "\\(publicHeaders)/React-jsi",
  "\\(publicHeaders)/hermes-engine",
  "\\(publicHeaders)/React-runtimescheduler",
  "\\(publicHeaders)/React-rendererconsistency",
  "\\(publicHeaders)/React-performancetimeline",
  "\\(publicHeaders)/React-timing",
  "\\(publicHeaders)/React-debug",
  "\\(publicHeaders)/React-callinvoker",
  "\\(publicHeaders)/React-runtimeexecutor",
  "\\(publicHeaders)/RCT-Folly",
  "\\(publicHeaders)/ReactNativeDependencies",
  "\\(publicHeaders)/glog",
  "\\(publicHeaders)/DoubleConversion",
  "\\(publicHeaders)/fmt",
  "\\(publicHeaders)/fast_float",
  "\\(reactNative)/ReactCommon",
  "\\(reactNative)/ReactCommon/jsi",
  "\\(reactNative)/ReactCommon/runtimeexecutor",
  "\\(reactNative)/ReactCommon/callinvoker",
  "\\(podsRoot)/RCT-Folly",
  "\\(podsRoot)/fmt/include",
  "\\(podsRoot)/glog/src",
  "\\(podsRoot)/DoubleConversion"
]

let generatedModuleMap = "\\(packageDir)/.generated/module.modulemap"
let apiNotesPath = "\\(packageDir)/APINotes"

let cxxIncludeFlags = headerSearchPaths.map({ "-I\\($0)" })
let swiftIncludeFlags = headerSearchPaths.flatMap({ ["-Xcc", "-I\\($0)"] })

let testFrameworks = resolveTestFrameworks()

let package = Package(
  name: "ExpoModulesJSI",
  platforms: [
    .iOS("16.4"),
    .tvOS("16.4"),
    .macOS("13.4")
  ],
  products: [
    .library(
      name: "ExpoModulesJSI",
      type: .dynamic,
      targets: ["ExpoModulesJSI"]
    )
  ],
  dependencies: [],
  targets: [
    // Swift target (public)
    .target(
      name: "ExpoModulesJSI",
      dependencies: [
        "ExpoModulesJSI-Cxx"
      ],
      swiftSettings: [
        .interoperabilityMode(.Cxx),
        .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
        .enableUpcomingFeature("InferIsolatedConformances"),
        .unsafeFlags([
          "-enable-library-evolution",
          "-emit-module-interface",
          "-no-verify-emitted-module-interface",
          "-Xfrontend",
          "-clang-header-expose-decls=has-expose-attr",
          "-Xcc", "-fmodule-map-file=\\(generatedModuleMap)",
          "-Xcc", "-iapinotes-modules",
          "-Xcc", apiNotesPath
        ]),
        .unsafeFlags(swiftIncludeFlags)
      ],
      linkerSettings: [
        .unsafeFlags([
          "-Xlinker", "-undefined", "-Xlinker", "dynamic_lookup"
        ])
      ]
    ),

    // C++ target (internal)
    .target(
      name: "ExpoModulesJSI-Cxx",
      dependencies: [],
      cxxSettings: [
        .unsafeFlags(cxxIncludeFlags)
      ]
    ),

    // Tests
    .testTarget(
      name: "Tests",
      dependencies: testFrameworks.dependencies
    )
  ] + testFrameworks.binaryTargets,
  swiftLanguageModes: [.v6],
  cxxLanguageStandard: .cxx20
)

func resolvePodsRoot() -> String {
  let env = ProcessInfo.processInfo.environment
  if let explicit = env["PODS_ROOT"] {
    return explicit
  }
  let repoRoot =
    env["EXPO_ROOT_DIR"]
    ?? URL(fileURLWithPath: packageDir)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .path
  return "\\(repoRoot)/apps/bare-expo/ios/Pods"
}

func resolveTestFrameworks() -> (binaryTargets: [Target], dependencies: [Target.Dependency]) {
  let names = ["React", "hermesvm", "ReactNativeDependencies"]
  let available = names.filter({
    FileManager.default.fileExists(atPath: "\\(packageDir)/.test-frameworks/\\($0).xcframework")
  })
  let binaryTargets: [Target] = available.map({
    .binaryTarget(name: $0, path: ".test-frameworks/\\($0).xcframework")
  })
  let dependencies: [Target.Dependency] =
    ["ExpoModulesJSI"]
    + available.map({ .target(name: $0) })
  return (binaryTargets, dependencies)
}
`;

const packageSwiftPath = path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Package.swift');
if (fs.existsSync(packageSwiftPath)) {
  fs.writeFileSync(packageSwiftPath, cleanExpoModulesJSIPackageSwift, 'utf8');
  console.log('✅ Rewrote ExpoModulesJSI Package.swift with pristine Swift 6.0 manifest');
}

// 2. Patch any other Package.swift files in node_modules
const macroPackageSwift = path.join(__dirname, '..', 'node_modules', '@expo', 'expo-modules-macros-plugin', 'apple', 'Package.swift');
if (fs.existsSync(macroPackageSwift)) {
  let macroContent = fs.readFileSync(macroPackageSwift, 'utf8');
  macroContent = macroContent.replace(/swift-tools-version:\s*6\.\d+/g, 'swift-tools-version: 6.0');
  macroContent = macroContent.replace(/,\s*\)/g, '\n    )');
  macroContent = macroContent.replace(/,\s*\]/g, '\n      ]');
  fs.writeFileSync(macroPackageSwift, macroContent, 'utf8');
  console.log('✅ Patched @expo/expo-modules-macros-plugin Package.swift');
}

// 3. Patch build-xcframework.sh
const buildXcframeworkPath = path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'scripts', 'build-xcframework.sh');
if (fs.existsSync(buildXcframeworkPath)) {
  let content = fs.readFileSync(buildXcframeworkPath, 'utf8');
  if (content.includes('-disableAutomaticPackageResolution')) {
    content = content.replace('-disableAutomaticPackageResolution \\', '');
    content = content.replace('-disableAutomaticPackageResolution', '');
    fs.writeFileSync(buildXcframeworkPath, content, 'utf8');
    console.log('✅ Patched build-xcframework.sh to allow automatic package resolution');
  }
}
