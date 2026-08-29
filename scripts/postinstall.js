const fs = require('fs');
const path = require('path');

const packageSwiftPath = path.join(__dirname, '..', 'node_modules', 'expo-modules-jsi', 'apple', 'Package.swift');
if (fs.existsSync(packageSwiftPath)) {
  let content = fs.readFileSync(packageSwiftPath, 'utf8');
  // 1. Downgrade tools version to 6.0
  content = content.replace(/swift-tools-version:\s*6\.\d+/g, 'swift-tools-version: 6.0');
  // 2. Remove all trailing commas before closing parentheses or brackets
  content = content.replace(/targets:\s*\["ExpoModulesJSI"\],/g, 'targets: ["ExpoModulesJSI"]');
  content = content.replace(/dependencies:\s*testFrameworks\.dependencies,/g, 'dependencies: testFrameworks.dependencies');
  fs.writeFileSync(packageSwiftPath, content, 'utf8');
  console.log('✅ Patched ExpoModulesJSI Package.swift for Xcode 16 / Swift 6.0 compatibility');
}

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
