import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'test/fixtures/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js', 'scripts/*.mjs'] },
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
    files: ['scripts/*.mjs'],
    languageOptions: { globals: { console: 'readonly' } },
  },
)
