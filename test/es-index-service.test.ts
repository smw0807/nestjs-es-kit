import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@elastic/elasticsearch';

import { EsField } from '../src/decorators/es-field.decorator.js';
import { EsIndex } from '../src/decorators/es-index.decorator.js';
import { EsIndexService } from '../src/services/es-index.service.js';

@EsIndex({ name: 'unit-pit-product' })
class PitProduct {
  @EsField({ type: 'keyword' })
  id!: string;
}

describe('EsIndexService scanAll', () => {
  it('uses refreshed PIT ids for subsequent searches and close', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce({
        pit_id: 'pit-2',
        hits: {
          hits: [{ _id: 'p1', _source: { id: 'p1' }, sort: [1] }],
        },
      })
      .mockResolvedValueOnce({
        pit_id: 'pit-3',
        hits: { hits: [] },
      });
    const closePointInTime = vi.fn().mockResolvedValue({});
    const client = {
      openPointInTime: vi.fn().mockResolvedValue({ id: 'pit-1' }),
      closePointInTime,
      search,
    } as unknown as Client;

    const service = new EsIndexService<PitProduct>(client, PitProduct);
    const batches: PitProduct[][] = [];

    for await (const batch of service.scanAll({ batchSize: 1 })) {
      batches.push(batch);
    }

    expect(batches).toEqual([[{ id: 'p1' }]]);
    expect(search).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        pit: { id: 'pit-1', keep_alive: '1m' },
      }),
    );
    expect(search).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        pit: { id: 'pit-2', keep_alive: '1m' },
        search_after: [1],
      }),
    );
    expect(closePointInTime).toHaveBeenCalledWith({ id: 'pit-3' });
  });
});
