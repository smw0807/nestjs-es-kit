import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { StartedTestContainer } from 'testcontainers';

import { EsField } from '../../src/decorators/es-field.decorator.js';
import { EsIndex } from '../../src/decorators/es-index.decorator.js';
import { EsIndexManager } from '../../src/services/index-manager.service.js';
import { EsIndexService } from '../../src/services/es-index.service.js';
import { cleanupIndices, startEsContainer, stopContainer } from './helpers.js';

@EsIndex({ name: 'it-svc-product', useAlias: true, settings: { numberOfReplicas: 0 } })
class SvcProduct {
  @EsField({ type: 'keyword' }) id!: string;
  @EsField({ type: 'keyword' }) category!: string;
  @EsField({ type: 'text' }) name!: string;
  @EsField({ type: 'integer' }) price!: number;
  @EsField({ type: 'date', format: 'strict_date_optional_time||epoch_millis' }) createdAt!: string;
}

let container: StartedTestContainer | null;
let client: Client;
let esNode: string;
let service: EsIndexService<SvcProduct>;

beforeAll(async () => {
  ({ container, client, esNode } = await startEsContainer());
  const manager = new EsIndexManager(client, { node: esNode, synchronize: 'create' }, []);
  await manager.create(SvcProduct);
  service = new EsIndexService<SvcProduct>(client, SvcProduct);
});

afterAll(async () => {
  await cleanupIndices(client, 'it-svc-product-v1');
  await stopContainer(container);
});

afterEach(async () => {
  await client.deleteByQuery({
    index: 'it-svc-product',
    body: { query: { match_all: {} } },
    refresh: true,
  });
});

const makeDoc = (overrides: Partial<SvcProduct> = {}): SvcProduct => ({
  id: 'p1',
  category: 'electronics',
  name: 'Laptop',
  price: 1_500_000,
  createdAt: '2024-01-01T00:00:00Z',
  ...overrides,
});

describe('EsIndexService — raw / indexName', () => {
  it('exposes the raw ES client', () => {
    expect(service.raw).toBeDefined();
    expect(typeof service.raw.search).toBe('function');
  });

  it('returns the alias as indexName when useAlias is true', () => {
    expect(service.indexName).toBe('it-svc-product');
  });
});

describe('EsIndexService — CRUD', () => {
  it('index returns the document id', async () => {
    const id = await service.index(makeDoc(), { id: 'p1', refresh: 'wait_for' });
    expect(id).toBe('p1');
  });

  it('get returns the document after indexing', async () => {
    await service.index(makeDoc(), { id: 'p1', refresh: 'wait_for' });
    const doc = await service.get('p1');
    expect(doc).toMatchObject({ id: 'p1', name: 'Laptop', price: 1_500_000 });
  });

  it('get returns null for a non-existent document', async () => {
    await expect(service.get('does-not-exist')).resolves.toBeNull();
  });

  it('update applies partial changes without overwriting other fields', async () => {
    await service.index(makeDoc(), { id: 'p1', refresh: 'wait_for' });
    await service.update('p1', { price: 999_000 }, { refresh: 'wait_for' });
    const doc = await service.get('p1');
    expect(doc?.price).toBe(999_000);
    expect(doc?.name).toBe('Laptop');
  });

  it('delete removes the document', async () => {
    await service.index(makeDoc(), { id: 'p1', refresh: 'wait_for' });
    await service.delete('p1', { refresh: 'wait_for' });
    await expect(service.get('p1')).resolves.toBeNull();
  });
});

describe('EsIndexService — bulkIndex', () => {
  const docs = [
    makeDoc({ id: 'b1', name: 'Laptop', price: 1_500_000, category: 'electronics' }),
    makeDoc({ id: 'b2', name: 'Phone', price: 800_000, category: 'electronics' }),
    makeDoc({ id: 'b3', name: 'Desk', price: 300_000, category: 'furniture' }),
  ];

  it('indexes all documents and returns the correct totals', async () => {
    const result = await service.bulkIndex(docs, { idSelector: (d) => d.id, refresh: 'wait_for' });
    expect(result.total).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(result.failed).toHaveLength(0);
  });

  it('documents are searchable after bulk index', async () => {
    await service.bulkIndex(docs, { idSelector: (d) => d.id, refresh: 'wait_for' });
    const result = await service.search({ size: 10 });
    expect(result.total).toBe(3);
  });

  it('respects chunkSize by processing documents in batches', async () => {
    const manyDocs = Array.from({ length: 5 }, (_, i) =>
      makeDoc({ id: `bulk-${String(i)}`, name: `Item ${String(i)}`, price: i * 1000 }),
    );
    const result = await service.bulkIndex(manyDocs, {
      idSelector: (d) => d.id,
      chunkSize: 2,
      refresh: 'wait_for',
    });
    expect(result.total).toBe(5);
    expect(result.succeeded).toBe(5);
  });
});

describe('EsIndexService — search', () => {
  beforeEach(async () => {
    await service.bulkIndex(
      [
        makeDoc({ id: 's1', name: 'Laptop Pro', price: 2_000_000, category: 'electronics' }),
        makeDoc({ id: 's2', name: 'Laptop Air', price: 1_200_000, category: 'electronics' }),
        makeDoc({ id: 's3', name: 'Standing Desk', price: 500_000, category: 'furniture' }),
      ],
      { idSelector: (d) => d.id, refresh: 'wait_for' },
    );
  });

  it('returns all documents with match_all', async () => {
    const result = await service.search({ query: { match_all: {} } });
    expect(result.total).toBe(3);
    expect(result.hits).toHaveLength(3);
    expect(result.rawHits[0]).toHaveProperty('id');
    expect(result.rawHits[0]).toHaveProperty('source');
  });

  it('filters documents by term query', async () => {
    const result = await service.search({ query: { term: { category: 'furniture' } } });
    expect(result.total).toBe(1);
    expect(result.hits[0]?.id).toBe('s3');
  });

  it('respects size and from for pagination', async () => {
    const page1 = await service.search({ query: { match_all: {} }, size: 2, from: 0 });
    const page2 = await service.search({ query: { match_all: {} }, size: 2, from: 2 });
    expect(page1.hits).toHaveLength(2);
    expect(page2.hits).toHaveLength(1);
  });

  it('sorts results by field', async () => {
    const result = await service.search({
      query: { match_all: {} },
      sort: [{ price: 'asc' }],
    });
    const prices = result.hits.map((h) => h.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });
});

describe('EsIndexService — searchAfter', () => {
  beforeEach(async () => {
    await service.bulkIndex(
      Array.from({ length: 5 }, (_, i) =>
        makeDoc({ id: `sa-${String(i)}`, name: `Item ${String(i)}`, price: (i + 1) * 100_000 }),
      ),
      { idSelector: (d) => d.id, refresh: 'wait_for' },
    );
  });

  it('returns a nextCursor for the next page', async () => {
    const page = await service.searchAfter({
      query: { match_all: {} },
      sort: [{ price: 'asc' }, { id: 'asc' }],
      size: 2,
    });
    expect(page.hits).toHaveLength(2);
    expect(page.nextCursor).toBeDefined();
  });

  it('uses nextCursor to fetch the next page without overlap', async () => {
    const page1 = await service.searchAfter({
      query: { match_all: {} },
      sort: [{ price: 'asc' }, { id: 'asc' }],
      size: 2,
    });
    const page2 = await service.searchAfter({
      query: { match_all: {} },
      sort: [{ price: 'asc' }, { id: 'asc' }],
      size: 2,
      ...(page1.nextCursor !== undefined ? { after: page1.nextCursor } : {}),
    });

    const ids1 = page1.hits.map((h) => h.id);
    const ids2 = page2.hits.map((h) => h.id);
    const overlap = ids1.filter((id) => ids2.includes(id));
    expect(overlap).toHaveLength(0);
    expect(ids1.length + ids2.length).toBe(4);
  });
});

describe('EsIndexService — aggregate', () => {
  beforeEach(async () => {
    await service.bulkIndex(
      [
        makeDoc({ id: 'a1', category: 'electronics', price: 1_000_000 }),
        makeDoc({ id: 'a2', category: 'electronics', price: 2_000_000 }),
        makeDoc({ id: 'a3', category: 'furniture', price: 500_000 }),
      ],
      { idSelector: (d) => d.id, refresh: 'wait_for' },
    );
  });

  it('executes a terms aggregation', async () => {
    const aggs = await service.aggregate({
      byCategory: { terms: { field: 'category', size: 10 } },
    });

    const result = aggs['byCategory'] as { buckets: Array<{ key: string; doc_count: number }> };
    const electronics = result.buckets.find((b) => b.key === 'electronics');
    expect(electronics?.doc_count).toBe(2);
  });

  it('executes an avg aggregation', async () => {
    const aggs = await service.aggregate({
      avgPrice: { avg: { field: 'price' } },
    });

    const result = aggs['avgPrice'] as { value: number };
    expect(result.value).toBeCloseTo(1_166_666, -3);
  });

  it('applies query filter before aggregating', async () => {
    const aggs = await service.aggregate(
      { avgPrice: { avg: { field: 'price' } } },
      { query: { term: { category: 'electronics' } } },
    );

    const result = aggs['avgPrice'] as { value: number };
    expect(result.value).toBeCloseTo(1_500_000, -3);
  });
});
