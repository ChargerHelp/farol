import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { cli: 'src/cli/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  // Bundle everything so the action runs from the committed dist/ without npm install.
  noExternal: [/.*/],
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __farolCreateRequire } from 'node:module';\nconst require = __farolCreateRequire(import.meta.url);\nimport { fileURLToPath as __farolFileURLToPath } from 'node:url';\nimport { dirname as __farolDirname } from 'node:path';\nconst __filename = __farolFileURLToPath(import.meta.url);\nconst __dirname = __farolDirname(__filename);",
  },
  splitting: false,
  sourcemap: false,
  minify: false,
})
