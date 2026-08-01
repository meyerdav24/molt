import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/', '**/.next/', '**/node_modules/', '**/*.config.*', '**/next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Card details and key material must never reach logs; keep console usage deliberate.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Plain-node test/tooling scripts: node globals, console allowed.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        TextEncoder: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
