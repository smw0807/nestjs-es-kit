import { describe, expect, it } from 'vitest';

import { validateCliConfig } from '../src/cli.js';

describe('validateCliConfig', () => {
  it('rejects missing schemas with a clear error', () => {
    expect(() => validateCliConfig({ node: 'http://localhost:9200' })).toThrow('schemas array');
  });

  it('rejects non-class schema values', () => {
    expect(() =>
      validateCliConfig({
        node: 'http://localhost:9200',
        schemas: [{}],
      }),
    ).toThrow('schema classes');
  });

  it('accepts valid node configs', () => {
    class Product {}

    expect(
      validateCliConfig({
        node: 'http://localhost:9200',
        schemas: [Product],
      }).schemas,
    ).toEqual([Product]);
  });
});
