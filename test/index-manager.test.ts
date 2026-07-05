import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@elastic/elasticsearch';

import { EsField } from '../src/decorators/es-field.decorator.js';
import { EsIndex } from '../src/decorators/es-index.decorator.js';
import { MigrationError } from '../src/errors/index.js';
import { EsIndexManager } from '../src/services/index-manager.service.js';

@EsIndex({ name: 'unit-migrate', version: 2 })
class UnitMigrateV2 {
  @EsField({ type: 'keyword' })
  id!: string;
}

class UnitNestedChild {
  @EsField({ type: 'keyword' })
  id!: string;

  @EsField({ type: 'integer' })
  rating!: number;
}

@EsIndex({ name: 'unit-nested' })
class UnitNestedParent {
  @EsField({ type: 'object', properties: () => UnitNestedChild })
  seller!: UnitNestedChild;
}

describe('EsIndexManager migrate', () => {
  it('does not swap aliases and cleans up the new index when reindex reports failures', async () => {
    const deleteIndex = vi.fn().mockResolvedValue({});
    const updateAliases = vi.fn().mockResolvedValue({});
    const client = {
      indices: {
        getAlias: vi.fn().mockResolvedValue({ 'unit-migrate-v1': { aliases: { 'unit-migrate': {} } } }),
        create: vi.fn().mockResolvedValue({}),
        delete: deleteIndex,
        updateAliases,
      },
      reindex: vi.fn().mockResolvedValue({
        timed_out: false,
        version_conflicts: 0,
        failures: [{ id: '1', cause: { reason: 'failed' } }],
      }),
    } as unknown as Client;

    const manager = new EsIndexManager(client, { node: 'http://localhost:9200' }, []);

    await expect(manager.migrate(UnitMigrateV2)).rejects.toBeInstanceOf(MigrationError);
    expect(updateAliases).not.toHaveBeenCalled();
    expect(deleteIndex).toHaveBeenCalledWith({ index: 'unit-migrate-v2', ignore_unavailable: true });
  });
});

describe('EsIndexManager syncMapping', () => {
  it('puts only newly added nested properties instead of treating the parent as breaking', async () => {
    const putMapping = vi.fn().mockResolvedValue({});
    const client = {
      indices: {
        exists: vi.fn().mockResolvedValue(true),
        getMapping: vi.fn().mockResolvedValue({
          'unit-nested-v1': {
            mappings: {
              properties: {
                seller: {
                  type: 'object',
                  properties: {
                    id: { type: 'keyword' },
                  },
                },
              },
            },
          },
        }),
        getSettings: vi.fn().mockResolvedValue({
          'unit-nested-v1': {
            settings: {
              index: {},
            },
          },
        }),
        putSettings: vi.fn().mockResolvedValue({}),
        putMapping,
      },
    } as unknown as Client;

    const manager = new EsIndexManager(client, { node: 'http://localhost:9200', synchronize: 'sync' }, []);

    await expect(manager.syncMapping(UnitNestedParent)).resolves.toBeUndefined();
    expect(putMapping).toHaveBeenCalledWith({
      index: 'unit-nested-v1',
      properties: {
        seller: {
          type: 'object',
          properties: {
            rating: { type: 'integer' },
          },
        },
      },
    });
  });
});
