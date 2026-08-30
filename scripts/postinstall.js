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
//    - RuntimeScheduler.h: Add createRuntimeScheduler factory functions.
//    - RetainedSwiftPointer.h & HostFunctionClosure.h: Add createHostFunctionClosure factory.
//    - HostObjectCallbacks.h & HostObject.h: Add makeHostObject factory function taking IRuntime.
//    - JSIUtils.h: Replace std::make_shared<MemoryBuffer> with std::shared_ptr<MemoryBuffer>(new ...) to fix __construct_at.
//
// 5. expo-modules-jsi Swift sources:
//    - Replace 'weak let' with 'nonisolated(unsafe) weak var' (for Swift 6.0 Sendable compatibility).
//    - Remove explicit 'Escapable' protocol conformance.
//    - Remove 'public' from 'extension expo.CppError' members (C++ types do not support library evolution).
//    - Convert typed throws 'throws(...)' to standard 'throws' (Swift 6.0 parser compatibility).
//    - Remove 'consuming:' label from vector.push_back (Swift 6.0 C++ stdlib interop).
//    - Strip any trailing commas before ')', ']', '}' (Swift 6.0 syntax compatibility).
//    - Patch JavaScriptActor.swift with clean withoutActuallyEscaping.
//    - Patch Task+immediate.swift for Swift 6.0 Task initializer signature.
//    - Update createFunctionClosure, createHostObject & RuntimeScheduler creation in JavaScriptRuntime.swift.
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

inline expo::RuntimeScheduler *createRuntimeScheduler() {
  return new expo::RuntimeScheduler();
}

inline expo::RuntimeScheduler *createRuntimeScheduler(void *scheduler, expo::RuntimeScheduler::ScheduleFn fn) {
  return new expo::RuntimeScheduler(scheduler, fn);
}

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
  console.log('✅ Patched RuntimeScheduler.h with createRuntimeScheduler factory functions');
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

// 4d. HostObjectCallbacks.h & HostObject.h
const hostCallbacksPath = path.join(cxxIncludeDir, 'HostObjectCallbacks.h');
if (fs.existsSync(hostCallbacksPath)) {
  const content = `#pragma once

#ifdef __cplusplus

#include <swift/bridging>
#include <jsi/jsi.h>
#include <vector>

#include "RetainedSwiftPointer.h"

namespace expo {

class HostObjectCallbacks final {
public:
  using Context = void *_Nonnull;
  using PropNameIds = std::vector<facebook::jsi::PropNameID>;
  using Getter = facebook::jsi::Value (*)(Context, const char *_Nonnull name);
  using Setter = void (*)(Context, const char *_Nonnull name, void *_Nonnull value);
  using PropertyNamesGetter = void (*)(Context, PropNameIds &out);
  using Deallocator = void (*)(Context);

  HostObjectCallbacks(Context context, Getter getter, Setter _Nullable setter, PropertyNamesGetter propertyNamesGetter, Deallocator deallocator)
  : _context(context), _getter(getter), _setter(setter), _propertyNamesGetter(propertyNamesGetter), _deallocator(deallocator) {}

  inline facebook::jsi::Value get(const char *_Nonnull name) const {
    return _getter(_context, name);
  }

  inline void set(facebook::jsi::Runtime &runtime, const char *_Nonnull name, const facebook::jsi::Value &value) const {
    if (_setter == nullptr) {
      throw facebook::jsi::JSError(
        runtime,
        std::string("Cannot set property '") + name + "' on a read-only host object: no setter was provided when the host object was created."
      );
    }
    _setter(_context, name, (void *)(&value));
  }

  inline PropNameIds getPropertyNames() const {
    PropNameIds names;
    if (_propertyNamesGetter != nullptr) {
      _propertyNamesGetter(_context, names);
    }
    return names;
  }

  inline void dealloc() {
    _deallocator(_context);
  }

private:
  Context _context;
  Getter _getter;
  Setter _setter;
  PropertyNamesGetter _propertyNamesGetter;
  Deallocator _deallocator;
};

inline void addPropNameId(HostObjectCallbacks::PropNameIds * _Nonnull vector, facebook::jsi::IRuntime &runtime, const char * _Nonnull name) {
  vector->push_back(facebook::jsi::PropNameID::forUtf8(runtime, name));
}

} // namespace expo

#endif // __cplusplus
`;
  fs.writeFileSync(hostCallbacksPath, content, 'utf8');
  console.log('✅ Patched HostObjectCallbacks.h with out-parameter PropertyNamesGetter');
}

const hostObjectPath = path.join(cxxIncludeDir, 'HostObject.h');
if (fs.existsSync(hostObjectPath)) {
  const hostObjectClean = `// Copyright 2025-present 650 Industries. All rights reserved.

#ifdef __cplusplus

#include <string>
#include <vector>
#include <memory>

#include "CppError.h"
#include "HostObjectCallbacks.h"
#include "IRuntimeCompat.h"

namespace jsi = facebook::jsi;

namespace expo {

class JSI_EXPORT HostObject : public jsi::HostObject {
public:

  explicit HostObject(HostObjectCallbacks callbacks) : jsi::HostObject(), _callbacks(callbacks) {}

  virtual ~HostObject() {
    _callbacks.dealloc();
  }

  inline jsi::Value get(jsi::Runtime &runtime, const jsi::PropNameID &name) override {
    auto result = _callbacks.get(name.utf8(runtime).c_str());
    if (auto *error = CppError::getCurrent()) {
      throw error->release();
    }
    return result;
  }

  inline void set(jsi::Runtime &runtime, const jsi::PropNameID &name, const jsi::Value &value) override {
    _callbacks.set(runtime, name.utf8(runtime).c_str(), value);
    if (auto *error = CppError::getCurrent()) {
      throw error->release();
    }
  }

  inline std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime &runtime) override {
    return _callbacks.getPropertyNames();
  }

  inline static jsi::Object makeObject(jsi::IRuntime &runtime, HostObjectCallbacks callbacks) {
    return jsi::Object::createFromHostObject(runtime, std::shared_ptr<HostObject>(new HostObject(callbacks)));
  }

private:
  HostObjectCallbacks _callbacks;

}; // class HostObject

inline facebook::jsi::Object makeHostObject(
  facebook::jsi::IRuntime &runtime,
  void *_Nonnull context,
  HostObjectCallbacks::Getter getter,
  HostObjectCallbacks::Setter setter,
  HostObjectCallbacks::PropertyNamesGetter propertyNamesGetter,
  HostObjectCallbacks::Deallocator deallocator
) {
  HostObjectCallbacks callbacks(context, getter, setter, propertyNamesGetter, deallocator);
  return HostObject::makeObject(runtime, callbacks);
}

} // namespace expo

#endif // __cplusplus
`;
  fs.writeFileSync(hostObjectPath, hostObjectClean, 'utf8');
  console.log('✅ Patched HostObject.h with makeHostObject factory function (IRuntime & new HostObject)');
}

// 4e. JSIUtils.h (fix all std::make_shared calls which trigger __construct_at in Xcode 16 / C++20)
const jsiUtilsPath = path.join(cxxIncludeDir, 'JSIUtils.h');
if (fs.existsSync(jsiUtilsPath)) {
  let content = fs.readFileSync(jsiUtilsPath, 'utf8');
  let changed = false;

  if (content.includes('std::make_shared<MemoryBuffer>')) {
    content = content
      .replace(
        'std::make_shared<MemoryBuffer>(data, size, [data]() { delete[] data; })',
        'std::shared_ptr<MemoryBuffer>(new MemoryBuffer(data, size, [data]() { delete[] data; }))'
      )
      .replace(
        /std::make_shared<MemoryBuffer>\(data,\s*size,\s*\[cleanupContext,\s*cleanupFunction\]\(\)\s*\{[\s\S]*?\}\)/g,
        'std::shared_ptr<MemoryBuffer>(new MemoryBuffer(data, size, [cleanupContext, cleanupFunction]() {\n    cleanupFunction(cleanupContext);\n  }))'
      );
    changed = true;
  }

  if (content.includes('std::make_shared<expo::NativeState>')) {
    content = content.replace(
      'std::make_shared<expo::NativeState>(context, deallocator)',
      'std::shared_ptr<expo::NativeState>(new expo::NativeState(context, deallocator))'
    );
    changed = true;
  }

  if (content.includes('std::make_shared<jsi::StringBuffer>')) {
    content = content.replace(
      'std::make_shared<jsi::StringBuffer>(source)',
      'std::shared_ptr<jsi::StringBuffer>(new jsi::StringBuffer(source))'
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(jsiUtilsPath, content, 'utf8');
    console.log('✅ Patched JSIUtils.h to replace all std::make_shared with std::shared_ptr(new ...)');
  } else {
    console.log('✔  JSIUtils.h already up-to-date');
  }
}

// 4f. CppError.h (fix all std::make_unique<CppError> which trigger __construct_at with move-only jsi::JSError)
const cppErrorPath = path.join(cxxIncludeDir, 'CppError.h');
if (fs.existsSync(cppErrorPath)) {
  let content = fs.readFileSync(cppErrorPath, 'utf8');
  let changed = false;
  if (content.includes('std::make_unique<CppError>')) {
    content = content
      .replace(
        '_current = std::make_unique<CppError>(std::move(e));',
        '_current = std::unique_ptr<CppError>(new CppError(std::move(e)));'
      )
      .replace(
        '_current = std::make_unique<CppError>(jsi::JSError(runtime, e.what()));',
        '_current = std::unique_ptr<CppError>(new CppError(jsi::JSError(runtime, e.what())));'
      )
      .replace(
        '_current = std::make_unique<CppError>(jsi::JSError(runtime, "Unknown C++ error"));',
        '_current = std::unique_ptr<CppError>(new CppError(jsi::JSError(runtime, "Unknown C++ error")));'
      )
      .replace(
        '_current = std::make_unique<CppError>(std::move(jsError));',
        '_current = std::unique_ptr<CppError>(new CppError(std::move(jsError)));'
      )
      .replace(
        '_current = std::make_unique<CppError>(std::move(cppError));',
        '_current = std::unique_ptr<CppError>(new CppError(std::move(cppError)));'
      )
      .replace(
        '_current = std::make_unique<CppError>(jsi::JSError(runtime, message));',
        '_current = std::unique_ptr<CppError>(new CppError(jsi::JSError(runtime, message)));'
      );
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(cppErrorPath, content, 'utf8');
    console.log('✅ Patched CppError.h to replace all std::make_unique with std::unique_ptr(new CppError(...))');
  } else {
    console.log('✔  CppError.h already up-to-date');
  }
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

      // Fix Task+immediate.swift for Swift 6.0 Task initializer
      if (entry.name === 'Task+immediate.swift') {
        const taskImmediateReplacement = `// swift-format-ignore-file: AlwaysUseLowerCamelCase

import Foundation

extension Task where Failure == any Error {
  @discardableResult
  public static func immediate_polyfill(
    name: String? = nil,
    priority: TaskPriority? = nil,
    @_inheritActorContext @_implicitSelfCapture operation: sending @escaping @isolated(any) () async throws -> Success
  ) -> Task<Success, any Error> {
    return Task(priority: priority ?? .high, operation: operation)
  }
}
`;
        content = taskImmediateReplacement;
        changed = true;
      }

      // Fix JavaScriptRuntime.swift HostFunctionClosure, HostObject & RuntimeScheduler creation
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

        if (content.includes('self.scheduler = expo.RuntimeScheduler(')) {
          content = content.replace(
            /self\.scheduler\s*=\s*expo\.RuntimeScheduler\(\)/g,
            'self.scheduler = expo.createRuntimeScheduler()'
          );
          content = content.replace(
            /self\.scheduler\s*=\s*expo\.RuntimeScheduler\((scheduler,\s*fn)\)/g,
            'self.scheduler = expo.createRuntimeScheduler($1)'
          );
          changed = true;
        }

        if (content.includes('let callbacks = expo.HostObjectCallbacks(')) {
          content = content.replace(
            /let\s+callbacks\s*=\s*expo\.HostObjectCallbacks\([\s\S]*?let\s+hostObject\s*=\s*expo\.HostObject\.makeObject\(pointee,\s*consume\s+callbacks\)/,
            'let hostObject = expo.makeHostObject(pointee, context, getter, set == nil ? nil : setterPointer, propertyNamesGetter, deallocate)'
          );
          changed = true;
        }

        if (content.includes('func propertyNamesGetter(')) {
          content = content.replace(
            /func\s+propertyNamesGetter\(context:\s*UnsafeMutableRawPointer\)[^{]*\{[\s\S]*?return\s+vector\s*\}/,
            `func propertyNamesGetter(context: UnsafeMutableRawPointer, outVector: UnsafeMutablePointer<expo.HostObjectCallbacks.PropNameIds>) {
      let context = Unmanaged<HostObjectContext>.fromOpaque(context).takeUnretainedValue()
      guard let runtime = context.runtime else { return }
      let propertyNames: [String] = JavaScriptActor.assumeIsolated {
        return context.getPropertyNames()
      }
      for propertyName in propertyNames {
        expo.addPropNameId(outVector, runtime.pointee, propertyName)
      }
    }`
          );
          changed = true;
        }

        if (content.includes('let object = createObject()')) {
          content = content.replace(
            'let object = createObject()',
            'let object = self.createObject()'
          );
          changed = true;
        }

        if (content.includes('global().setProperty(')) {
          content = content.replace(
            'global().setProperty(',
            'self.global().setProperty('
          );
          changed = true;
        }

        if (content.includes('capturingCppErrors')) {
          content = content.replace(
            /let\s+jsiValue\s*=\s*try\s+capturingCppErrors\s*\{[\s\S]*?return\s+expo\.evaluateJavaScript[\s\S]*?\}/,
            `let jsiValue = expo.evaluateJavaScript(pointee, stringBuffer, std.string(label ?? "<<evaluated>>"))
      try checkCppError()`
          );
          changed = true;
        }
      }

      // Fix ErrorHandling.swift non-copyable type handling
      if (entry.name === 'ErrorHandling.swift') {
        if (content.includes('internal func capturingCppErrors<R: ~Copyable>')) {
          content = content.replace(
            /internal\s+func\s+capturingCppErrors<R:\s*~Copyable>[\s\S]*?return\s+result\s*\}/,
            `internal func checkCppError() throws {
  if let cppError = getCurrentCppError() {
    throw cppError
  }
}

internal func capturingCppErrors<R>(_ block: () throws -> R) throws -> R {
  let result: R = try block()
  try checkCppError()
  return result
}`
          );
          changed = true;
        }
      }

      // Fix JavaScriptFunction.swift non-copyable type return from capturingCppErrors
      if (entry.name === 'JavaScriptFunction.swift') {
        if (content.includes('return try capturingCppErrors {')) {
          content = content
            .replace(
              /return\s+try\s+capturingCppErrors\s*\{\s*return\s+JavaScriptValue\(\s*runtime,\s*expo\.callFunctionWithThis\([^\)]+\)\s*\)\s*\}/,
              `let jsiResult = expo.callFunctionWithThis(runtime.pointee, pointee, this.pointee, arguments?.baseAddress, arguments?.count ?? 0)
    let result = JavaScriptValue(runtime, jsiResult)
    try checkCppError()
    return result`
            )
            .replace(
              /return\s+try\s+capturingCppErrors\s*\{\s*return\s+JavaScriptValue\(\s*runtime,\s*expo\.callFunction\([^\)]+\)\s*\)\s*\}/,
              `let jsiResult = expo.callFunction(runtime.pointee, pointee, arguments?.baseAddress, arguments?.count ?? 0)
    let result = JavaScriptValue(runtime, jsiResult)
    try checkCppError()
    return result`
            )
            .replace(
              /return\s+try\s+capturingCppErrors\s*\{\s*let\s+jsiResult\s*=\s*expo\.callAsConstructor\([^\)]+\)\s*return\s+JavaScriptValue\(runtime,\s*jsiResult\)\s*\}/,
              `let jsiResult = expo.callAsConstructor(runtime.pointee, pointee, arguments?.baseAddress, arguments?.count ?? 0)
    let result = JavaScriptValue(runtime, jsiResult)
    try checkCppError()
    return result`
            );
          changed = true;
        }
      }

      // Fix JavaScriptActor.swift for Swift 6.0
      if (entry.name === 'JavaScriptActor.swift') {
        const fullActorReplacement = `import Foundation
internal import jsi
internal import ExpoModulesJSI_Cxx

@globalActor
public actor JavaScriptActor: GlobalActor {
  public static let shared = JavaScriptActor()

  private init() {}

  nonisolated private let executor = JavaScriptExecutor()

  nonisolated public var unownedExecutor: UnownedSerialExecutor {
    return executor.asUnownedSerialExecutor()
  }

  public static func assumeIsolated(_ operation: @escaping @JavaScriptActor () -> facebook.jsi.Value) -> facebook.jsi.Value {
    Self.checkIsolated()
    typealias RawFn = () -> facebook.jsi.Value
    let raw = unsafeBitCast(operation, to: RawFn.self)
    return raw()
  }

  public static func assumeIsolated(_ operation: @escaping @JavaScriptActor () -> Void) {
    Self.checkIsolated()
    typealias RawFn = () -> Void
    let raw = unsafeBitCast(operation, to: RawFn.self)
    raw()
  }

  public static func assumeIsolated<T>(_ operation: @escaping @JavaScriptActor () throws -> T) throws -> T {
    Self.checkIsolated()
    typealias RawFn = () throws -> T
    let raw = unsafeBitCast(operation, to: RawFn.self)
    return try raw()
  }

  public static func assumeIsolated<T>(_ operation: @escaping @JavaScriptActor () -> T) -> T {
    Self.checkIsolated()
    typealias RawFn = () -> T
    let raw = unsafeBitCast(operation, to: RawFn.self)
    return raw()
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
  console.log('✅ Patched expo-modules-jsi Swift files (nonisolated weak var, Escapable, CppError, JavaScriptActor, typed throws, consuming: label, createHostFunctionClosure, createRuntimeScheduler, Task+immediate, makeHostObject)');
} else {
  console.log('⚠️  expo-modules-jsi Sources dir not found');
}

console.log('✅ Postinstall completed successfully');
