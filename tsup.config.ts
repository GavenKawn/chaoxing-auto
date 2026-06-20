import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'bin/cli.ts',
    index: 'src/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  clean: true,
  dts: true,
  sourcemap: true,
  minify: false,
});
