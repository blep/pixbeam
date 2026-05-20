import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Browser source files: strict browser globals — no Buffer, process, require, etc.
  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-undef': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      // Non-null assertions are intentional: DOM lookups we control, and
      // array indexes mandated by noUncheckedIndexedAccess in tsconfig.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  // Node.js files: test helpers, config, scripts
  {
    files: ['tests/**/*.ts', '*.config.ts', '*.config.js'],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
