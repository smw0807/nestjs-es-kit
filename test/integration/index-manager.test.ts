import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { StartedTestContainer } from 'testcontainers';

import { EsField } from '../../src/decorators/es-field.decorator.js';
import { EsIndex } from '../../src/decorators/es-index.decorator.js';
import { BreakingSchemaChangeError } from '../../src/errors/index.js';
import { EsIndexManager } from '../../src/services/index-manager.service.js';
import type { EsKitModuleOptions } from '../../src/types.js';
import { cleanupIndices, startEsContainer, stopContainer } from './helpers.js';

// --- Schema definitions ---

@EsIndex({ name: 'it-im-product', useAlias: true, settings: { numberOfReplicas: 0 } })
class ImProduct {
  @EsField({ type: 'keyword' }) id!: string;
  @EsField({ type: 'text' }) name!: string;
}

// Same index name, extra field for diff/sync tests
@EsIndex({ name: 'it-im-product', useAlias: true, settings: { numberOfReplicas: 0 } })
class ImProductWithPrice {
  @EsField({ type: 'keyword' }) id!: string;
  @EsField({ type: 'text' }) name!: string;
  @EsField({ type: 'integer' }) price!: number;
}

// Breaking change: 'name' type changed from text → keyword
@EsIndex({ name: 'it-im-product', useAlias: true, settings: { numberOfReplicas: 0 } })
class ImProductBreaking {
  @EsField({ type: 'keyword' }) id!: string;
  @EsField({ type: 'keyword' }) name!: string;
}

// Separate index for alias test
@EsIndex({ name: 'it-im-order', useAlias: true, settings: { numberOfReplicas: 0 } })
class ImOrder {
  @EsField({ type: 'keyword' }) orderId!: string;
}

// useAlias: false
@EsIndex({ name: 'it-im-simple', useAlias: false, settings: { numberOfReplicas: 0 } })
class ImSimple {
  @EsField({ type: 'keyword' }) id!: string;
}

// ---

let container: StartedTestContainer | null;
let client: Client;
let esNode: string;

const makeManager = (synchronize: EsKitModuleOptions['synchronize'] = 'create'): EsIndexManager =>
  new EsIndexManager(client, { node: esNode, synchronize }, []);

beforeAll(async () => {
  ({ container, client, esNode } = await startEsContainer());
});

afterAll(async () => {
  await stopContainer(container);
});

afterEach(async () => {
  await cleanupIndices(client, 'it-im-product-v1', 'it-im-order-v1', 'it-im-simple');
});

describe('EsIndexManager — create', () => {
  it('creates the physical index and alias when index does not exist', async () => {
    const manager = makeManager('create');
    await manager.create(ImProduct);

    const indexExists = await client.indices.exists({ index: 'it-im-product-v1' });
    const aliasExists = await client.indices.existsAlias({ name: 'it-im-product' });
    expect(indexExists).toBe(true);
    expect(aliasExists).toBe(true);
  });

  it('is a no-op when the index already exists', async () => {
    const manager = makeManager();
    await manager.create(ImProduct);
    await expect(manager.create(ImProduct)).resolves.toBeUndefined();
  });

  it('creates physical index without alias when useAlias is false', async () => {
    const manager = makeManager();
    await manager.create(ImSimple);

    const indexExists = await client.indices.exists({ index: 'it-im-simple' });
    const aliasExists = await client.indices.existsAlias({ name: 'it-im-simple' });
    expect(indexExists).toBe(true);
    expect(aliasExists).toBe(false);
  });
});

describe('EsIndexManager — exists', () => {
  it('returns false before index is created', async () => {
    const manager = makeManager();
    await expect(manager.exists(ImProduct)).resolves.toBe(false);
  });

  it('returns true after index is created', async () => {
    const manager = makeManager();
    await manager.create(ImProduct);
    await expect(manager.exists(ImProduct)).resolves.toBe(true);
  });
});

describe('EsIndexManager — delete', () => {
  it('deletes the index when force is true', async () => {
    const manager = makeManager();
    await manager.create(ImProduct);
    await manager.delete(ImProduct, { force: true });
    await expect(manager.exists(ImProduct)).resolves.toBe(false);
  });

  it('throws without force option', async () => {
    const manager = makeManager();
    await expect(manager.delete(ImProduct)).rejects.toThrow('{ force: true }');
  });
});

describe('EsIndexManager — diff', () => {
  it('returns all declared fields as added when index does not exist', async () => {
    const manager = makeManager();
    const diff = await manager.diff(ImProduct);
    expect(diff.addedFields).toContain('id');
    expect(diff.addedFields).toContain('name');
    expect(diff.isBreaking).toBe(false);
  });

  it('detects added fields after index is created', async () => {
    const manager = makeManager();
    await manager.create(ImProduct);

    const diff = await manager.diff(ImProductWithPrice);
    expect(diff.addedFields).toEqual(['price']);
    expect(diff.changedFields).toHaveLength(0);
    expect(diff.isBreaking).toBe(false);
  });

  it('detects breaking mapping changes', async () => {
    const manager = makeManager();
    await manager.create(ImProduct);

    const diff = await manager.diff(ImProductBreaking);
    expect(diff.isBreaking).toBe(true);
    expect(diff.changedFields.map((c) => c.field)).toContain('name');
  });
});

describe('EsIndexManager — syncMapping', () => {
  it('creates the index when it does not exist', async () => {
    const manager = makeManager('sync');
    await manager.syncMapping(ImProduct);
    await expect(manager.exists(ImProduct)).resolves.toBe(true);
  });

  it('adds new fields via put_mapping when index already exists', async () => {
    const manager = makeManager('sync');
    await manager.create(ImProduct);
    await manager.syncMapping(ImProductWithPrice);

    const mapping = await client.indices.getMapping({ index: 'it-im-product-v1' });
    const properties = mapping['it-im-product-v1']?.mappings.properties ?? {};
    expect(properties).toHaveProperty('price');
  });

  it('throws BreakingSchemaChangeError on type change', async () => {
    const manager = makeManager('sync');
    await manager.create(ImProduct);
    await expect(manager.syncMapping(ImProductBreaking)).rejects.toBeInstanceOf(BreakingSchemaChangeError);
  });
});

describe('EsIndexManager — synchronizeSchemas', () => {
  it('creates all schemas in create mode', async () => {
    const manager = makeManager('create');
    await manager.synchronizeSchemas([ImProduct, ImOrder]);
    await expect(manager.exists(ImProduct)).resolves.toBe(true);
    await expect(manager.exists(ImOrder)).resolves.toBe(true);
  });

  it('does nothing in none mode', async () => {
    const manager = makeManager('none');
    await manager.synchronizeSchemas([ImProduct]);
    await expect(manager.exists(ImProduct)).resolves.toBe(false);
  });

  it('runs independently for multiple feature module schema sets', async () => {
    const managerA = makeManager('create');
    const managerB = managerA;

    // Simulates two separate forFeature calls using the same manager instance
    await managerA.synchronizeSchemas([ImProduct]);
    await managerB.synchronizeSchemas([ImOrder]);

    await expect(managerA.exists(ImProduct)).resolves.toBe(true);
    await expect(managerA.exists(ImOrder)).resolves.toBe(true);
  });
});
