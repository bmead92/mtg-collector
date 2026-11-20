// Signs release builds with a private keystore when ~/.gradle/gradle.properties names one
// (MTG_RELEASE_STORE_FILE / _STORE_PASSWORD / _KEY_ALIAS / _KEY_PASSWORD); otherwise the debug key is used.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @generated withReleaseSigning';

const SNIPPET = `
${MARKER}
def releaseStore = findProperty('MTG_RELEASE_STORE_FILE')
if (releaseStore) {
    android.signingConfigs.create('release') {
        storeFile file(releaseStore)
        storePassword findProperty('MTG_RELEASE_STORE_PASSWORD')
        keyAlias findProperty('MTG_RELEASE_KEY_ALIAS')
        keyPassword findProperty('MTG_RELEASE_KEY_PASSWORD')
    }
    android.buildTypes.release.signingConfig android.signingConfigs.release
}
`;

module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes(MARKER)) c.modResults.contents += SNIPPET;
    return c;
  });
