const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withSwift5(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      if (fs.existsSync(podfilePath)) {
        let content = fs.readFileSync(podfilePath, 'utf8');
        const hook = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
        config.build_settings['OTHER_SWIFT_FLAGS'] ||= ['$(inherited)']
        config.build_settings['OTHER_SWIFT_FLAGS'] << '-suppress-warnings'
      end
    end
`;
        if (content.includes('post_install do |installer|') && !content.includes("config.build_settings['SWIFT_STRICT_CONCURRENCY']")) {
          content = content.replace('post_install do |installer|', 'post_install do |installer|' + hook);
          fs.writeFileSync(podfilePath, content, 'utf8');
        }
      }
      return config;
    },
  ]);
};
