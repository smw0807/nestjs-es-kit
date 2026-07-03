import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { StartedTestContainer } from 'testcontainers';

import { EsField } from '../../src/decorators/es-field.decorator.js';
import { EsIndex } from '../../src/decorators/es-index.decorator.js';
import { koreanAnalysis } from '../../src/analysis/korean.preset.js';
import { EsIndexManager } from '../../src/services/index-manager.service.js';
import { EsIndexService } from '../../src/services/es-index.service.js';
import {
  cleanupIndices,
  isNoriAvailable,
  startNoriContainer,
  stopContainer,
} from './helpers.js';

@EsIndex({
  name: 'it-nori-article',
  useAlias: true,
  settings: {
    numberOfReplicas: 0,
    analysis: koreanAnalysis(),
  },
})
class NoriArticle {
  @EsField({ type: 'keyword' }) id!: string;
  @EsField({ type: 'text', analyzer: 'nori_analyzer' }) title!: string;
  @EsField({ type: 'text', analyzer: 'nori_analyzer' }) body!: string;
}

@EsIndex({
  name: 'it-nori-synonym',
  useAlias: true,
  settings: {
    numberOfReplicas: 0,
    analysis: koreanAnalysis({ synonyms: ['노트북, 랩탑'] }),
  },
})
class NoriSynonymArticle {
  @EsField({ type: 'keyword' }) id!: string;
  @EsField({ type: 'text', analyzer: 'nori_analyzer' }) title!: string;
}

let container: StartedTestContainer | null;
let client: Client;
let esNode: string;
let noriAvailable = false;

beforeAll(async () => {
  ({ container, client, esNode } = await startNoriContainer());
  noriAvailable = await isNoriAvailable(client);
  if (!noriAvailable) {
    console.warn(
      '[nori.test] analysis-nori plugin not installed on this ES instance — skipping nori tests.',
    );
  }
});

afterAll(async () => {
  await cleanupIndices(client, 'it-nori-article-v1', 'it-nori-synonym-v1');
  await stopContainer(container);
});

const skipIfNoNori = () => {
  if (!noriAvailable) return true;
  return false;
};

describe('koreanAnalysis preset', () => {
  it('creates an index with nori settings successfully', async () => {
    if (skipIfNoNori()) return;
    const manager = new EsIndexManager(client, { node: esNode, synchronize: 'create' }, []);
    await manager.create(NoriArticle);
    await expect(manager.exists(NoriArticle)).resolves.toBe(true);
  });

  it('indexes and searches Korean text with nori analyzer', async () => {
    if (skipIfNoNori()) return;
    const manager = new EsIndexManager(client, { node: esNode, synchronize: 'create' }, []);
    await manager.create(NoriArticle);
    const service = new EsIndexService<NoriArticle>(client, NoriArticle);

    await service.index(
      { id: 'n1', title: '삼성 노트북 구매', body: '최신 노트북을 구매했습니다.' },
      { id: 'n1', refresh: 'wait_for' },
    );
    await service.index(
      { id: 'n2', title: '애플 아이폰 리뷰', body: '새로운 스마트폰을 사용해 보았습니다.' },
      { id: 'n2', refresh: 'wait_for' },
    );

    const result = await service.search({ query: { match: { title: '노트북' } } });
    expect(result.total).toBe(1);
    expect(result.hits[0]?.id).toBe('n1');
  });

  it('tokenizes Korean text correctly via the analyze API', async () => {
    if (skipIfNoNori()) return;
    const manager = new EsIndexManager(client, { node: esNode, synchronize: 'create' }, []);
    await manager.create(NoriArticle);

    const response = await client.indices.analyze({
      index: 'it-nori-article-v1',
      body: { analyzer: 'nori_analyzer', text: '삼성 노트북을 구매했습니다' },
    });

    const tokens = (response.tokens ?? []).map((t) => t.token);
    expect(tokens).toContain('삼성');
    expect(tokens).toContain('노트북');
  });
});

describe('koreanAnalysis with synonyms', () => {
  it('creates an index with synonym filter successfully', async () => {
    if (skipIfNoNori()) return;
    const manager = new EsIndexManager(client, { node: esNode, synchronize: 'create' }, []);
    await manager.create(NoriSynonymArticle);
    await expect(manager.exists(NoriSynonymArticle)).resolves.toBe(true);
  });

  it('matches synonyms during search', async () => {
    if (skipIfNoNori()) return;
    const manager = new EsIndexManager(client, { node: esNode, synchronize: 'create' }, []);
    await manager.create(NoriSynonymArticle);
    const service = new EsIndexService<NoriSynonymArticle>(client, NoriSynonymArticle);

    await service.index(
      { id: 'syn1', title: '노트북 추천 목록' },
      { id: 'syn1', refresh: 'wait_for' },
    );

    // '랩탑' is a synonym of '노트북' — should find the document
    const result = await service.search({ query: { match: { title: '랩탑' } } });
    expect(result.total).toBe(1);
  });
});
