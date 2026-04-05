import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'daemon/index': 'src/daemon/index.ts',
    'mcp/server': 'src/mcp/server.ts',
    'api/server': 'src/api/server.ts',
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
