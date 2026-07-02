import { describe, expect, it } from 'vitest';

import { koreanAnalysis } from '../src/analysis/korean.preset.js';
import { EsField } from '../src/decorators/es-field.decorator.js';
import { EsIndex } from '../src/decorators/es-index.decorator.js';
import { SchemaBuilder } from '../src/metadata/schema-builder.js';

describe('SchemaBuilder', () => {
  it('builds Elasticsearch settings and mappings from decorators', () => {
    @EsIndex({
      name: 'products',
      useAlias: true,
      settings: {
        numberOfShards: 3,
        numberOfReplicas: 1,
        analysis: koreanAnalysis(),
      },
      dynamicTemplates: [
        {
          name: 'strings_as_keyword',
          matchMappingType: 'string',
          mapping: { type: 'keyword' },
        },
      ],
    })
    class Product {
      @EsField({ type: 'keyword' })
      id!: string;

      @EsField({
        type: 'text',
        analyzer: 'nori_analyzer',
        fields: { raw: { type: 'keyword' } },
      })
      name!: string;
    }

    expect(new SchemaBuilder().build(Product)).toMatchObject({
      index: 'products-v1',
      alias: 'products',
      useAlias: true,
      settings: {
        number_of_shards: 3,
        number_of_replicas: 1,
      },
      mappings: {
        dynamic_templates: [
          {
            strings_as_keyword: {
              matchMappingType: 'string',
              mapping: { type: 'keyword' },
            },
          },
        ],
        properties: {
          id: { type: 'keyword' },
          name: {
            type: 'text',
            analyzer: 'nori_analyzer',
            fields: { raw: { type: 'keyword' } },
          },
        },
      },
    });
  });
});
