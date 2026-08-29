const fs = require('fs');
const path = require('path');

// 1. Patch any Package.swift files with trailing comma issues in SPM manifests
const macroPackageSwift = path.join(__dirname, '..', 'node_modules', '@expo', 'expo-modules-macros-plugin', 'apple', 'Package.swift');
if (fs.existsSync(macroPackageSwift)) {
  let macroContent = fs.readFileSync(macroPackageSwift, 'utf8');
  macroContent = macroContent.replace(/swift-tools-version:\s*6\.\d+/g, 'swift-tools-version: 6.0');
  macroContent = macroContent.replace(/,\s*\)/g, '\n    )');
  macroContent = macroContent.replace(/,\s*\]/g, '\n      ]');
  fs.writeFileSync(macroPackageSwift, macroContent, 'utf8');
  console.log('✅ Patched @expo/expo-modules-macros-plugin Package.swift');
}

console.log('✅ Postinstall completed successfully');
