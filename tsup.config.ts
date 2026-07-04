import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/health.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ['@elastic/elasticsearch', '@nestjs/common', '@nestjs/core', '@nestjs/terminus', 'reflect-metadata'],
});
