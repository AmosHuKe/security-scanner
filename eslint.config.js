import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier/flat'
import { defineConfig, globalIgnores } from 'eslint/config'

const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
    },
  },
  prettier,
  globalIgnores([
    'node_modules/**',
  ]),
])

export default eslintConfig
