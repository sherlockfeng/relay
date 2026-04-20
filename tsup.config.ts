import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'mcp/server': 'src/mcp/server.ts',
    'mcp/run': 'src/mcp/run.ts',
  },
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: true,
  treeshake: true,
});
