const fs = require('fs');
const path = require('path');

// 1. Patch @expo/expo-modules-macros-plugin Package.swift for Xcode 16.1 SPM resolution
const macroPackageSwift = path.join(__dirname, '..', 'node_modules', '@expo', 'expo-modules-macros-plugin', 'apple', 'Package.swift');
if (fs.existsSync(macroPackageSwift)) {
  let macroContent = fs.readFileSync(macroPackageSwift, 'utf8');
  // Replace Swift 6.2 beta syntax dependency with Xcode 16.1 (Swift 6.0) compatible version
  macroContent = macroContent.replace(/from:\s*"602\.0\.0-latest"/g, 'from: "509.0.0"');
  macroContent = macroContent.replace(/swift-tools-version:\s*6\.\d+/g, 'swift-tools-version: 6.0');
  macroContent = macroContent.replace(/,\s*\)/g, '\n    )');
  macroContent = macroContent.replace(/,\s*\]/g, '\n      ]');
  fs.writeFileSync(macroPackageSwift, macroContent, 'utf8');
  console.log('✅ Patched @expo/expo-modules-macros-plugin Package.swift for Xcode 16.1 SPM resolution');
}

console.log('✅ Postinstall completed successfully');
