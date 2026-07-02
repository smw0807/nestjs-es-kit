import { describe, expect, it } from 'vitest';

import { diffMappings } from '../src/migration/schema-diff.js';

describe('diffMappings', () => {
  it('marks added fields as non-breaking', () => {
    expect(
      diffMappings(
        {
          id: { type: 'keyword' },
          name: { type: 'text' },
        },
        {
          id: { type: 'keyword' },
        },
      ),
    ).toMatchObject({
      addedFields: ['name'],
      changedFields: [],
      removedFields: [],
      isBreaking: false,
    });
  });

  it('marks mapping changes as breaking', () => {
    expect(
      diffMappings(
        {
          price: { type: 'long' },
        },
        {
          price: { type: 'integer' },
        },
      ),
    ).toMatchObject({
      changedFields: [
        {
          field: 'price',
          before: { type: 'integer' },
          after: { type: 'long' },
        },
      ],
      isBreaking: true,
    });
  });
});
