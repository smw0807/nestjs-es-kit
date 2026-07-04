import { defineConfig } from 'tsup';

const external = ['@elastic/elasticsearch', '@nestjs/common', '@nestjs/core', '@nestjs/terminus', 'reflect-metadata'];

export default defineConfig([
  // Library (ESM + CJS with type declarations)
  {
    entry: ['src/index.ts', 'src/health.ts', 'src/standalone.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    external,
  },
  // CLI (ESM only, no declarations, shebang prepended)
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: false,
    clean: false,
    splitting: false,
    external,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
