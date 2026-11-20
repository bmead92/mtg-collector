// Windows workaround: CMake/Ninja (SDK cmake 3.22.1 ships ninja 1.10.2) cannot create paths longer than
// 260 chars. Native libs build into node_modules/<lib>/android/.cxx/... and CMake then nests the full
// absolute source path inside that, which overflows for Nitro-based modules.
// This moves every native module's CMake staging dir to a short folder: %USERPROFILE%\.cxx\<project>.
// Kept as a config plugin so it survives `expo prebuild --clean`.
const { withAppBuildGradle, withProjectBuildGradle } = require('expo/config-plugins');

const MARKER = '// @generated withWindowsShortCxxPaths';

const SNIPPET = `
${MARKER}
if (System.getProperty('os.name').toLowerCase().contains('windows')) {
    def shortCxxRoot = new File(System.getProperty('user.home'), '.cxx')
    subprojects { sub ->
        ['com.android.library', 'com.android.application'].each { pluginId ->
            sub.plugins.withId(pluginId) {
                // Must be set while the module is still being evaluated (AGP reads it at the end of
                // evaluation). It is harmless for modules without native code.
                if (!sub.state.executed) {
                    sub.android.externalNativeBuild.cmake.buildStagingDirectory = new File(shortCxxRoot, sub.name)
                } else {
                    logger.warn("withWindowsShortCxxPaths: \${sub.name} was already evaluated; skipped")
                }
            }
        }
    }
}
`;

// The app module is evaluated before the root script's subprojects hook can reach it,
// so set its staging dir from inside app/build.gradle itself.
const APP_SNIPPET = `
${MARKER}
if (System.getProperty('os.name').toLowerCase().contains('windows')) {
    android.externalNativeBuild.cmake.buildStagingDirectory = new File(System.getProperty('user.home'), '.cxx/app')
}
`;

module.exports = function withWindowsShortCxxPaths(config) {
  config = withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += SNIPPET;
    }
    return cfg;
  });
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += APP_SNIPPET;
    }
    return cfg;
  });
};
