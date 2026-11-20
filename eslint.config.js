const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'modules/*/android/build/*'],
  },
  {
    files: ['scripts/**/*.{js,cjs,mjs}', 'plugins/**/*.js'],
    languageOptions: { globals: globals.node },
  },
]);
