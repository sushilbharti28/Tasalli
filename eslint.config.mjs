// Shared ESLint flat config for every workspace package.
// Packages run `eslint .` from their own folder; ESLint finds this file by
// walking up. A package may add its own eslint.config.mjs that imports and
// extends this one (e.g. React Native or Next.js rules).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.expo/**',
  '**/.next/**',
  '**/.terraform/**',
  '**/android/**',
  '**/ios/**',
];

export default tseslint.config(
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
      // Safety rule 8: never log raw data by accident. Use the logger, which masks phone numbers.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**', '**/tests/**'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-explicit-any': 'off' },
  },
  prettier,
);
