import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'test/fixtures/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js', 'scripts/*.mjs', 'assets/report/*.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'child_process', importNames: ['exec', 'execSync'], message: 'Use execFile: never run git through a shell.' },
            { name: 'node:child_process', importNames: ['exec', 'execSync'], message: 'Use execFile: never run git through a shell.' },
          ],
        },
      ],
      'max-lines': ['error', { max: 400 }],
    },
  },
  {
    files: ['eslint.config.js', 'scripts/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Browser scripts of the HTML report, embedded by scripts/embed-assets.mjs: classic scripts sharing the page's
    // global scope (one file defines what the next one uses), so undefined and unused names are not checked here.
    files: ['assets/report/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { ...tseslint.configs.disableTypeChecked.languageOptions, sourceType: 'script', ecmaVersion: 2023 },
    rules: { ...tseslint.configs.disableTypeChecked.rules, 'no-undef': 'off', 'no-unused-vars': 'off', '@typescript-eslint/no-unused-vars': 'off', 'max-lines': ['error', { max: 400 }] },
  },
  {
    files: ['scripts/*.mjs'],
    languageOptions: { globals: { console: 'readonly' } },
  },
)
