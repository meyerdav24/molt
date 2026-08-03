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
    // CLIs talk to humans on stdout; that is their job.
    files: ['apps/mcp-server/src/wallet-cli.ts', 'packages/protocol/src/cli.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // k6 load scripts run inside k6's runtime, not node.
    files: ['scripts/load/**/*.js'],
    languageOptions: {
      globals: { __ENV: 'readonly', __ITER: 'readonly' },
    },
  },
  {
    // Plain-node test/tooling scripts: node globals, console allowed.
    files: ['scripts/**/*.mjs', 'demo/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        TextEncoder: 'readonly',
        AbortSignal: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
);
