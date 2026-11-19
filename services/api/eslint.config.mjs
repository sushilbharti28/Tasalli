import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-console': 'error', // use the redacting logger (safety rule 8)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  { files: ['test/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  { ignores: ['node_modules', 'dist', 'jest.config.js'] },
);
