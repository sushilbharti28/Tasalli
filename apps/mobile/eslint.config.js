const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'src/api/schema.d.ts', '.expo/*'] },
  {
    // React Compiler lint rules are too strict for the plain data-loading hooks used here.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'import/namespace': 'off',
      'import/no-named-as-default-member': 'off',
    },
  },
]);
