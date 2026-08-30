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
//    Replace with a clean Swift 6.0 Package.swift (removing Swift 6.2 tools version,
//    experimental features, and trailing commas in argument lists that break Swift 6.0).
//
// 4. expo-modules-jsi C++ Headers:
//    - RuntimeScheduler.h: Add #define SWIFT_RETURNS_RETAINED __attribute__((swift_attr("returns_retained"))).
//    - RetainedSwiftPointer.h & HostFunctionClosure.h: Add createHostFunctionClosure C++ factory function.
//
// 5. expo-modules-jsi Swift sources:
//    - Replace 'weak let' with 'nonisolated(unsafe) weak var' (for Swift 6.0 Sendable compatibility).
//    - Remove explicit 'Escapable' protocol conformance.
//    - Remove 'public' from 'extension expo.CppError' members (C++ types do not support library evolution).
//    - Convert typed throws 'throws(...)' to standard 'throws' (Swift 6.0 parser compatibility).
//    - Remove 'consuming:' label from vector.push_back (Swift 6.0 C++ stdlib interop).
//    - Strip any trailing commas before ')', ']', '}' (Swift 6.0 syntax compatibility).
//    - Patch JavaScriptActor.swift with clean withoutActuallyEscaping.
//    - Update createFunctionClosure to return UnsafeMutablePointer<expo.HostFunctionClosure>.
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
// 3. Replace expo-modules-jsi/apple/Package.swift with Swift 6.0 clean syntax
// ─────────────────────────────────────────────────────────────────────────────
const jsiPackageSwift = path.join(
  __dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Package.swift'
);
if (fs.existsSync(jsiPackageSwift)) {
  const cleanSwiftContent = `// swift-tools-version: 6.0
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
        .headerSearchPath("include/Public"),
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

  fs.writeFileSync(jsiPackageSwift, cleanSwiftContent, 'utf8');
  console.log('✅ Wrote clean Swift 6.0 expo-modules-jsi Package.swift (no trailing commas, tools 6.0)');
} else {
  console.log('⚠️  expo-modules-jsi/apple/Package.swift not found');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Patch expo-modules-jsi C++ Headers
// ─────────────────────────────────────────────────────────────────────────────
const cxxIncludeDir = path.join(
  __dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple',
  'Sources', 'ExpoModulesJSI-Cxx', 'include'
);

// 4a. RuntimeScheduler.h
const runtimeSchedulerPath = path.join(cxxIncludeDir, 'RuntimeScheduler.h');
if (fs.existsSync(runtimeSchedulerPath)) {
  const content = `#pragma once

#ifdef __cplusplus

#include <atomic>
#include <swift/bridging>

#ifndef SWIFT_RETURNS_RETAINED
#if __has_attribute(swift_attr)
#define SWIFT_RETURNS_RETAINED __attribute__((swift_attr("returns_retained")))
#else
#define SWIFT_RETURNS_RETAINED
#endif
#endif

namespace expo {

class RuntimeScheduler {
public:
  enum class Priority : int {
    ImmediatePriority = 1,
    UserBlockingPriority = 2,
    NormalPriority = 3,
    LowPriority = 4,
    IdlePriority = 5,
  };

  using ScheduleTaskCallback = void(^)();
  using ScheduleFn = void (*)(void *nativeScheduler, int priority, ScheduleTaskCallback callback);

private:
  void *const nativeScheduler{nullptr};
  const ScheduleFn scheduleFn{nullptr};

  std::atomic<int> refCount{1};

public:
  SWIFT_RETURNS_RETAINED RuntimeScheduler(void *scheduler, ScheduleFn fn) noexcept
      : nativeScheduler(scheduler), scheduleFn(fn) {}

  SWIFT_RETURNS_RETAINED RuntimeScheduler() {}

  RuntimeScheduler(const RuntimeScheduler &) = delete;

  bool supportsAsyncScheduling() const noexcept {
    return scheduleFn != nullptr;
  }

  void scheduleTask(Priority priority, ScheduleTaskCallback callback) noexcept {
    if (scheduleFn != nullptr) {
      scheduleFn(nativeScheduler, static_cast<int>(priority), callback);
    } else {
      callback();
    }
  }

  void retain() {
    refCount.fetch_add(1, std::memory_order_relaxed);
  }

  void release() {
    if (refCount.fetch_sub(1, std::memory_order_acq_rel) == 1) {
      delete this;
    }
  }
} SWIFT_SHARED_REFERENCE(retainRuntimeScheduler, releaseRuntimeScheduler);

} // namespace expo

inline void retainRuntimeScheduler(expo::RuntimeScheduler *scheduler) {
  scheduler->retain();
}

inline void releaseRuntimeScheduler(expo::RuntimeScheduler *scheduler) {
  scheduler->release();
}

#endif // __cplusplus
`;
  fs.writeFileSync(runtimeSchedulerPath, content, 'utf8');
  console.log('✅ Patched RuntimeScheduler.h with returns_retained attribute');
}

// 4b. RetainedSwiftPointer.h
const retainedPointerPath = path.join(cxxIncludeDir, 'RetainedSwiftPointer.h');
if (fs.existsSync(retainedPointerPath)) {
  const content = `#pragma once

#include <memory>
#include <swift/bridging>

namespace expo {

class RetainedSwiftPointer {
public:
  using Context = void *_Nonnull;
  using Deallocator = void (*)(Context);

  RetainedSwiftPointer(Context context, Deallocator deallocator) : _context(context), _deallocator(deallocator) {}

  virtual ~RetainedSwiftPointer() = default;

protected:
  Context _context;
  Deallocator _deallocator;
};

} // namespace expo
`;
  fs.writeFileSync(retainedPointerPath, content, 'utf8');
  console.log('✅ Patched RetainedSwiftPointer.h');
}

// 4c. HostFunctionClosure.h
const hostClosurePath = path.join(cxxIncludeDir, 'HostFunctionClosure.h');
if (fs.existsSync(hostClosurePath)) {
  const content = `#pragma once

#include <swift/bridging>
#include <jsi/jsi.h>

#include "RetainedSwiftPointer.h"

namespace expo {

class HostFunctionClosure final : public RetainedSwiftPointer {
public:
  using Closure = facebook::jsi::Value (*)(Context context, const facebook::jsi::Value *_Nonnull thisValue, const facebook::jsi::Value *_Nonnull args, size_t count);

  HostFunctionClosure(Context context, Closure closure, Deallocator deallocator) : RetainedSwiftPointer(context, deallocator), _closure(closure) {}

  virtual ~HostFunctionClosure() {
    _deallocator(_context);
  }

  inline facebook::jsi::Value call(const facebook::jsi::Value &thisValue, const facebook::jsi::Value *_Nonnull args, size_t count) const {
    return _closure(_context, &thisValue, args, count);
  }

private:
  Closure _closure;
};

inline HostFunctionClosure * _Nonnull createHostFunctionClosure(void * _Nonnull context, HostFunctionClosure::Closure closure, RetainedSwiftPointer::Deallocator deallocator) {
  return new HostFunctionClosure(context, closure, deallocator);
}

} // namespace expo
`;
  fs.writeFileSync(hostClosurePath, content, 'utf8');
  console.log('✅ Patched HostFunctionClosure.h with createHostFunctionClosure factory');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Patch expo-modules-jsi Swift sources for Swift 6.0 compatibility
// ─────────────────────────────────────────────────────────────────────────────
const jsiSourcesDir = path.join(
  __dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Sources', 'ExpoModulesJSI'
);

function patchSwiftFilesRecursively(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      patchSwiftFilesRecursively(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.swift')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let changed = false;

      // Replace 'weak let' or plain 'weak var' with 'nonisolated(unsafe) weak var'
      if (content.includes('weak let') || (content.includes('weak var') && !content.includes('nonisolated(unsafe) weak var'))) {
        content = content
          .replace(/\bnonisolated\(unsafe\)\s+weak\s+var\b/g, '___TEMP_NONISOLATED_WEAK___')
          .replace(/\bweak\s+(?:let|var)\b/g, 'nonisolated(unsafe) weak var')
          .replace(/___TEMP_NONISOLATED_WEAK___/g, 'nonisolated(unsafe) weak var');
        changed = true;
      }

      // Remove ', Escapable' / ': Escapable' protocol conformance
      if (content.includes('Escapable')) {
        content = content
          .replace(/,\s*Escapable\b/g, '')
          .replace(/:\s*Escapable\b/g, '');
        changed = true;
      }

      // Convert typed throws 'throws(...)' -> 'throws' for Swift 6.0 parser compatibility
      if (content.includes('throws(')) {
        content = content.replace(/\bthrows\s*\([^)]+\)/g, 'throws');
        changed = true;
      }

      // Remove 'consuming:' label from push_back (Swift 6.0 C++ interop compatibility)
      if (content.includes('push_back(consuming:')) {
        content = content.replace(/\.push_back\(consuming:\s*/g, '.push_back(');
        changed = true;
      }

      // Strip any trailing commas before ')', ']', '}'
      const commaFixed = content.replace(/,\s*([\)\]\}])/g, '$1');
      if (commaFixed !== content) {
        content = commaFixed;
        changed = true;
      }

      // Fix CppError extension in library evolution mode (remove public from members)
      if (entry.name === 'JavaScriptError.swift' && content.includes('extension expo.CppError')) {
        content = content.replace(
          /extension\s+expo\.CppError[^{]*\{[\s\S]*?public\s+var\s+message/,
          (match) => match.replace('public var message', 'var message')
        );
        changed = true;
      }

      // Fix JavaScriptRuntime.swift HostFunctionClosure creation
      if (entry.name === 'JavaScriptRuntime.swift') {
        if (content.includes('return expo.HostFunctionClosure(context, call, deallocate)')) {
          content = content.replace(
            /->\s*expo\.HostFunctionClosure\s*\{/g,
            '-> UnsafeMutablePointer<expo.HostFunctionClosure> {'
          );
          content = content.replace(
            /return\s+expo\.HostFunctionClosure\(context,\s*call,\s*deallocate\)/g,
            'return expo.createHostFunctionClosure(context, call, deallocate)'
          );
          changed = true;
        }
      }

      // Fix JavaScriptActor.swift for Swift 6.0
      if (entry.name === 'JavaScriptActor.swift') {
        const fullActorReplacement = `import Foundation

@globalActor
public actor JavaScriptActor: GlobalActor {
  public static let shared = JavaScriptActor()

  private init() {}

  nonisolated private let executor = JavaScriptExecutor()

  nonisolated public var unownedExecutor: UnownedSerialExecutor {
    return executor.asUnownedSerialExecutor()
  }

  @_alwaysEmitIntoClient
  @inline(__always)
  public static func assumeIsolated<T: ~Copyable>(_ operation: @JavaScriptActor () throws -> T) rethrows -> T {
    Self.checkIsolated()
    return try withoutActuallyEscaping(operation) { escapedOp in
      typealias RawFn = () throws -> T
      let raw = unsafeBitCast(escapedOp, to: RawFn.self)
      return try raw()
    }
  }

  @inlinable
  @inline(__always)
  public static func checkIsolated() {
    assert(
      Thread.current.name == "com.facebook.react.runtime.JavaScript" || !Thread.isMultiThreaded()
        || ProcessInfo.processInfo.processName == "xctest",
      "JavaScriptActor operations must be run on the JavaScript thread"
    )
  }
}

internal class JavaScriptExecutor: SerialExecutor, @unchecked Sendable {
  func enqueue(_ job: UnownedJob) {
    job.runSynchronously(on: self.asUnownedSerialExecutor())
  }

  func asUnownedSerialExecutor() -> UnownedSerialExecutor {
    return UnownedSerialExecutor(ordinary: self)
  }

  func checkIsolated() {
    JavaScriptActor.checkIsolated()
  }
}

internal actor JavaScriptRuntimeActor {
  private nonisolated(unsafe) weak var runtime: JavaScriptRuntime?
  nonisolated private let executor: JavaScriptExecutor

  init(runtime: JavaScriptRuntime) {
    self.runtime = runtime
    self.executor = JavaScriptRuntimeExecutor(runtime: runtime)
  }

  nonisolated var unownedExecutor: UnownedSerialExecutor {
    return executor.asUnownedSerialExecutor()
  }

  func execute<R: Sendable>(_ operation: @escaping @JavaScriptActor () async throws -> R) async rethrows -> sending R {
    return try await operation()
  }
}

internal final class JavaScriptRuntimeExecutor: JavaScriptExecutor, @unchecked Sendable {
  private nonisolated(unsafe) weak var runtime: JavaScriptRuntime?

  init(runtime: JavaScriptRuntime) {
    self.runtime = runtime
  }

  override func enqueue(_ job: UnownedJob) {
    runtime?.schedule(priority: .immediate) {
      job.runSynchronously(on: self.asUnownedSerialExecutor())
    }
  }
}
`;
        content = fullActorReplacement;
        changed = true;
      }

      if (changed) {
        fs.writeFileSync(fullPath, content, 'utf8');
      }
    }
  }
}

if (fs.existsSync(jsiSourcesDir)) {
  patchSwiftFilesRecursively(jsiSourcesDir);
  console.log('✅ Patched expo-modules-jsi Swift files (nonisolated weak var, Escapable, CppError, JavaScriptActor, typed throws, consuming: label, createHostFunctionClosure)');
} else {
  console.log('⚠️  expo-modules-jsi Sources dir not found');
}

console.log('✅ Postinstall completed successfully');
