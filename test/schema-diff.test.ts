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

  it('marks added nested object fields as non-breaking dotted paths', () => {
    expect(
      diffMappings(
        {
          seller: {
            type: 'object',
            properties: {
              id: { type: 'keyword' },
              rating: { type: 'integer' },
            },
          },
        },
        {
          seller: {
            type: 'object',
            properties: {
              id: { type: 'keyword' },
            },
          },
        },
      ),
    ).toMatchObject({
      addedFields: ['seller.rating'],
      changedFields: [],
      removedFields: [],
      isBreaking: false,
    });
  });

  it('marks nested object mapping changes as breaking dotted paths', () => {
    expect(
      diffMappings(
        {
          seller: {
            type: 'object',
            properties: {
              rating: { type: 'integer' },
            },
          },
        },
        {
          seller: {
            type: 'object',
            properties: {
              rating: { type: 'long' },
            },
          },
        },
      ),
    ).toMatchObject({
      addedFields: [],
      changedFields: [
        {
          field: 'seller.rating',
          before: { type: 'long' },
          after: { type: 'integer' },
        },
      ],
      isBreaking: true,
    });
  });
});
