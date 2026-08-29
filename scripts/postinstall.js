const fs = require('fs');
const path = require('path');

// 1. Completely rewrite ExpoModulesJSI Package.swift with 100% valid Swift 6 SPM manifest
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
        .unsafeFlags([
          "-Xfrontend",
          "-clang-header-expose-decls=has-expose-attr",
          "-Xcc", "-fmodule-map-file=\\(generatedModuleMap)",
          "-Xcc", "-iapinotes-modules",
          "-Xcc", apiNotesPath,
          "-enable-bare-slash-regex"
        ]),
        .enableExperimentalFeature("NonescapableTypes"),
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
  console.log('✅ Rewrote ExpoModulesJSI Package.swift with pristine Swift 6 manifest');
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

// 4. Swift source patcher (idempotent)
function patchSwiftFiles(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      patchSwiftFiles(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.swift')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let modified = false;

      // Fix weak let
      if (content.includes('weak let')) {
        content = content.replace(/\bweak\s+let\b/g, 'weak var');
        modified = true;
      }

      // Fix Sendable mutable weak references idempotently
      if (entry.name === 'HostFunctionContext.swift' || entry.name === 'HostObjectContext.swift') {
        if (content.includes('class HostFunctionContext: Sendable') || content.includes('class HostObjectContext: Sendable')) {
          content = content.replace(/: Sendable \{/g, ': @unchecked Sendable {');
          modified = true;
        }
      }

      if (entry.name === 'JavaScriptPropNameID.swift' || entry.name === 'JavaScriptError.swift' || entry.name === 'JavaScriptValue.swift') {
        // Clean out duplicate nonisolated(unsafe)
        content = content.replace(/(?:nonisolated\(unsafe\)\s+)+/g, 'nonisolated(unsafe) ');
        if (content.includes('private weak var runtime:') && !content.includes('nonisolated(unsafe) private weak var runtime:')) {
          content = content.replace('private weak var runtime:', 'nonisolated(unsafe) private weak var runtime:');
          modified = true;
        }
        if (content.includes('internal weak var runtime:') && !content.includes('nonisolated(unsafe) internal weak var runtime:')) {
          content = content.replace('internal weak var runtime:', 'nonisolated(unsafe) internal weak var runtime:');
          modified = true;
        }
      }

      // Fix Task+immediate
      if (entry.name === 'Task+immediate.swift') {
        const cleanTaskImmediate = `import Foundation

extension Task where Failure == any Error {
  public static func immediate(
    priority: TaskPriority? = nil,
    @_inheritActorContext operation: @escaping () async throws -> Success
  ) -> Task<Success, any Error> {
    return Task(priority: priority ?? .high, operation: operation)
  }
}
`;
        if (content !== cleanTaskImmediate) {
          content = cleanTaskImmediate;
          modified = true;
        }
      }

      // Fix JavaScriptActor.swift runIsolated isolation boundary
      if (entry.name === 'JavaScriptActor.swift') {
        if (content.includes('@JavaScriptActor\n  @usableFromInline\n  internal static func runIsolated')) {
          content = content.replace('@JavaScriptActor\n  @usableFromInline\n  internal static func runIsolated', '@usableFromInline\n  internal static func runIsolated');
          modified = true;
        }
      }

      // Fix JavaScriptPromise.swift LongLivedState isolation
      if (entry.name === 'JavaScriptPromise.swift') {
        if (content.includes('@JavaScriptActor\n  private final class LongLivedState')) {
          content = content.replace('@JavaScriptActor\n  private final class LongLivedState', 'private final class LongLivedState: @unchecked Sendable');
          modified = true;
        }
      }

      if (modified) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`✅ Patched Swift source: ${entry.name}`);
      }
    }
  }
}

// 5. C++ header patcher with clean dedicated SwiftBridging.h
const includeDir = path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Sources', 'ExpoModulesJSI-Cxx', 'include');
if (fs.existsSync(includeDir)) {
  const swiftBridgingPath = path.join(includeDir, 'SwiftBridging.h');
  const swiftBridgingContent = `#pragma once

#if __has_include(<swift/bridging>)
#include <swift/bridging>
#endif

#if __has_attribute(swift_attr)
#ifndef SWIFT_RETURNS_RETAINED
#define SWIFT_RETURNS_RETAINED __attribute__((swift_attr("returns_retained")))
#endif
#ifndef SWIFT_RETURNS_INDEPENDENT_VALUE
#define SWIFT_RETURNS_INDEPENDENT_VALUE __attribute__((swift_attr("returns_independent_value")))
#endif
#ifndef SWIFT_SHARED_REFERENCE
#define SWIFT_SHARED_REFERENCE(retain, release) __attribute__((swift_attr("retain:" #retain))) __attribute__((swift_attr("release:" #release)))
#endif
#ifndef SWIFT_IMMORTAL_REFERENCE
#define SWIFT_IMMORTAL_REFERENCE __attribute__((swift_attr("immortal")))
#endif
#ifndef SWIFT_NONCOPYABLE
#define SWIFT_NONCOPYABLE __attribute__((swift_attr("~Copyable")))
#endif
#ifndef SWIFT_UNCHECKED_SENDABLE
#define SWIFT_UNCHECKED_SENDABLE __attribute__((swift_attr("@unchecked Sendable")))
#endif
#ifndef SWIFT_COMPUTED_PROPERTY
#define SWIFT_COMPUTED_PROPERTY __attribute__((swift_attr("computed_property")))
#endif
#ifndef SWIFT_NAME
#define SWIFT_NAME(name) __attribute__((swift_attr("getter:" #name)))
#endif
#else
#ifndef SWIFT_RETURNS_RETAINED
#define SWIFT_RETURNS_RETAINED
#endif
#ifndef SWIFT_RETURNS_INDEPENDENT_VALUE
#define SWIFT_RETURNS_INDEPENDENT_VALUE
#endif
#ifndef SWIFT_SHARED_REFERENCE
#define SWIFT_SHARED_REFERENCE(retain, release)
#endif
#ifndef SWIFT_IMMORTAL_REFERENCE
#define SWIFT_IMMORTAL_REFERENCE
#endif
#ifndef SWIFT_NONCOPYABLE
#define SWIFT_NONCOPYABLE
#endif
#ifndef SWIFT_UNCHECKED_SENDABLE
#define SWIFT_UNCHECKED_SENDABLE
#endif
#ifndef SWIFT_COMPUTED_PROPERTY
#define SWIFT_COMPUTED_PROPERTY
#endif
#ifndef SWIFT_NAME
#define SWIFT_NAME(name)
#endif
#endif
`;
  fs.writeFileSync(swiftBridgingPath, swiftBridgingContent, 'utf8');
  console.log('✅ Created SwiftBridging.h');

  // Exact clean Public/NativeState.h
  const publicDir = path.join(includeDir, 'Public');
  if (fs.existsSync(publicDir)) {
    const nativeStatePath = path.join(publicDir, 'NativeState.h');
    const cleanNativeState = `#pragma once

#include "../SwiftBridging.h"
#include <memory>
#include <jsi/jsi.h>

namespace expo {

/**
 Base class for \`jsi::NativeState\` instances that need to round-trip through
 a Swift wrapper. Holds an opaque context pointer and a destructor callback
 that runs when the underlying shared_ptr is released. The context pointer is
 opaque to C++ — only the producer of the instance interprets it.
 */
class NativeState : public facebook::jsi::NativeState {
public:
  using Context = void *;
  using ContextDeallocator = void (*)(Context);

  explicit NativeState(Context context = nullptr, ContextDeallocator contextDeallocator = nullptr)
    : _context(context), _contextDeallocator(contextDeallocator) {}

  NativeState(NativeState &&other) noexcept
    : _context(other._context), _contextDeallocator(other._contextDeallocator) {
    other._contextDeallocator = nullptr;
  }
  NativeState &operator=(NativeState &&other) noexcept {
    if (this != &other) {
      if (_contextDeallocator) {
        _contextDeallocator(_context);
      }
      _context = other._context;
      _contextDeallocator = other._contextDeallocator;
      other._contextDeallocator = nullptr;
    }
    return *this;
  }

  ~NativeState() override {
    if (_contextDeallocator) {
      _contextDeallocator(_context);
    }
  }

  SWIFT_RETURNS_INDEPENDENT_VALUE
  inline Context getContext() const {
    return _context;
  }

private:
  Context _context;
  ContextDeallocator _contextDeallocator;
};

using NativeStateShared = std::shared_ptr<facebook::jsi::NativeState>;
using NativeStateWeak = std::weak_ptr<facebook::jsi::NativeState>;

} // namespace expo
`;
    fs.writeFileSync(nativeStatePath, cleanNativeState, 'utf8');
    console.log('✅ Wrote pristine Public/NativeState.h');
  }

  // Exact clean RetainedSwiftPointer.h
  const retainedSwiftPointerPath = path.join(includeDir, 'RetainedSwiftPointer.h');
  const cleanRetainedSwiftPointer = `#pragma once

#include "SwiftBridging.h"
#include <memory>

namespace expo {

/**
 Holds a type-erased pointer to a Swift instance that is now owned by this C++ instance.
 Derived classes must call the deallocator function once the pointer is no longer necessary and can be released by Swift.
 */
class RetainedSwiftPointer {
public:
  using Context = void *_Nonnull;
  using Deallocator = void(Context);

  RetainedSwiftPointer(Context context, Deallocator deallocator) : _context(context), _deallocator(std::move(deallocator)) {}

  virtual ~RetainedSwiftPointer() = default;

protected:
  Context _context;
  Deallocator *_Nonnull _deallocator;

} SWIFT_IMMORTAL_REFERENCE; // class RetainedSwiftPointer

} // namespace expo
`;
  fs.writeFileSync(retainedSwiftPointerPath, cleanRetainedSwiftPointer, 'utf8');

  // Exact clean HostFunctionClosure.h
  const hostFunctionClosurePath = path.join(includeDir, 'HostFunctionClosure.h');
  const cleanHostFunctionClosure = `#pragma once

#include "SwiftBridging.h"
#include <jsi/jsi.h>
#include "RetainedSwiftPointer.h"

namespace expo {

/**
 Holds a pointer to a closure in Swift that provides host function's implementation.
 */
class HostFunctionClosure final : public RetainedSwiftPointer {
public:
  using Closure = facebook::jsi::Value(Context context, const facebook::jsi::Value *_Nonnull thisValue, const facebook::jsi::Value *_Nonnull args, size_t count);

  HostFunctionClosure(Context context, Closure closure, Deallocator deallocator) : RetainedSwiftPointer(context, deallocator), _closure(closure) {};

  virtual ~HostFunctionClosure() {
    _deallocator(_context);
  }

  /**
   Calls the Swift closure with given \`this\` value and arguments.
   */
  inline facebook::jsi::Value call(const facebook::jsi::Value &thisValue, const facebook::jsi::Value *_Nonnull args, size_t count) const {
    return _closure(_context, &thisValue, args, count);
  }

private:
  Closure *_Nonnull _closure;

} SWIFT_IMMORTAL_REFERENCE; // class HostFunctionClosure

} // namespace expo
`;
  fs.writeFileSync(hostFunctionClosurePath, cleanHostFunctionClosure, 'utf8');

  // Fix JSIUtils.h missing #endif
  const jsiUtilsPath = path.join(includeDir, 'JSIUtils.h');
  if (fs.existsSync(jsiUtilsPath)) {
    let jsiContent = fs.readFileSync(jsiUtilsPath, 'utf8');
    if (!jsiContent.includes('SwiftBridging.h')) {
      jsiContent = jsiContent.replace('#pragma once', '#pragma once\n\n#include "SwiftBridging.h"');
    }
    if (jsiContent.includes('tryBorrowMutableBuffer') && !jsiContent.includes('#else\n  return {nullptr, 0, nullptr};\n#endif')) {
      jsiContent = jsiContent.replace(
        /return \{data, size, retained\};\n\}/g,
        'return {data, size, retained};\n#else\n  return {nullptr, 0, nullptr};\n#endif\n}'
      );
      jsiContent = jsiContent.replace(
        /delete static_cast<std::shared_ptr<jsi::MutableBuffer> \*>\(retainer\);\n\}/g,
        'delete static_cast<std::shared_ptr<jsi::MutableBuffer> *>(retainer);\n#endif\n}'
      );
    }
    fs.writeFileSync(jsiUtilsPath, jsiContent, 'utf8');
    console.log('✅ Patched JSIUtils.h with complete #if/#endif blocks');
  }

  // Exact clean RuntimeScheduler.h
  const runtimeSchedulerPath = path.join(includeDir, 'RuntimeScheduler.h');
  const cleanRuntimeScheduler = `#pragma once

#ifdef __cplusplus

#include "SwiftBridging.h"
#include <atomic>

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
  RuntimeScheduler(void *scheduler, ScheduleFn fn) noexcept
      : nativeScheduler(scheduler), scheduleFn(fn) {}

  RuntimeScheduler() {}

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
  fs.writeFileSync(runtimeSchedulerPath, cleanRuntimeScheduler, 'utf8');
  console.log('✅ Wrote clean RuntimeScheduler.h');

  // Fix CppError.h
  const cppErrorPath = path.join(includeDir, 'CppError.h');
  if (fs.existsSync(cppErrorPath)) {
    let cppContent = fs.readFileSync(cppErrorPath, 'utf8');
    if (!cppContent.includes('SwiftBridging.h')) {
      cppContent = cppContent.replace('#pragma once', '#pragma once\n\n#include "SwiftBridging.h"');
    }
    fs.writeFileSync(cppErrorPath, cppContent, 'utf8');
    console.log('✅ Patched CppError.h');
  }

  // 6. Automated sanity check: verify ALL headers in ExpoModulesJSI-Cxx/include have 100% balanced #if / #endif
  function verifyHeaders(d) {
    for (const f of fs.readdirSync(d)) {
      const full = path.join(d, f);
      if (fs.statSync(full).isDirectory()) {
        verifyHeaders(full);
      } else if (f.endsWith('.h')) {
        const content = fs.readFileSync(full, 'utf8');
        const ifs = (content.match(/#\s*if(?:def|ndef)?\b/g) || []).length;
        const endifs = (content.match(/#\s*endif\b/g) || []).length;
        if (ifs !== endifs) {
          throw new Error(`[FATAL] Header directive mismatch in ${f}: ${ifs} #if vs ${endifs} #endif`);
        }
        console.log(`✅ Verified balanced directives in ${f} (${ifs} #if / ${endifs} #endif)`);
      }
    }
  }

  verifyHeaders(includeDir);
}

const sourcesDir = path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Sources');
patchSwiftFiles(sourcesDir);
