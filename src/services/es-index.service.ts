import type { Client, estypes } from '@elastic/elasticsearch';

import { BulkPartialFailureError } from '../errors/index.js';
import { SchemaBuilder } from '../metadata/schema-builder.js';
import type {
  BulkFailedItem,
  BulkIndexOptions,
  BulkResult,
  EsDocumentClass,
  EsScanOptions,
  EsSearchAfterResult,
  EsSearchOptions,
  EsSearchResult,
} from '../types.js';

export class EsIndexService<TDocument extends object> {
  private readonly schemaBuilder = new SchemaBuilder();
  readonly indexName: string;

  constructor(
    readonly raw: Client,
    private readonly target: EsDocumentClass<TDocument>,
  ) {
    const schema = this.schemaBuilder.build(target);
    this.indexName = schema.useAlias ? schema.alias : schema.index;
  }

  async index(doc: TDocument, options: { id?: string; refresh?: boolean | 'wait_for' } = {}): Promise<string | undefined> {
    const request: estypes.IndexRequest<TDocument> = {
      index: this.indexName,
      document: doc,
    };

    if (options.id !== undefined) {
      request.id = options.id;
    }

    if (options.refresh !== undefined) {
      request.refresh = options.refresh;
    }

    const response = await this.raw.index<TDocument>(request);

    return response._id;
  }

  async get(id: string): Promise<TDocument | null> {
    const response = await this.raw.get<TDocument>(
      {
        index: this.indexName,
        id,
      },
      { ignore: [404] },
    );

    if (!response.found) {
      return null;
    }

    return response._source ?? null;
  }

  async update(id: string, partial: Partial<TDocument>, options: { refresh?: boolean | 'wait_for' } = {}): Promise<void> {
    const request: estypes.UpdateRequest<TDocument, Partial<TDocument>> = {
      index: this.indexName,
      id,
      doc: partial,
    };

    if (options.refresh !== undefined) {
      request.refresh = options.refresh;
    }

    await this.raw.update<TDocument, Partial<TDocument>>(request);
  }

  async delete(id: string, options: { refresh?: boolean | 'wait_for' } = {}): Promise<void> {
    const request: estypes.DeleteRequest = { index: this.indexName, id };

    if (options.refresh !== undefined) {
      request.refresh = options.refresh;
    }

    await this.raw.delete(request);
  }

  async bulkIndex(docs: readonly TDocument[], options: BulkIndexOptions<TDocument> = {}): Promise<BulkResult<TDocument>> {
    const chunkSize = options.chunkSize ?? 1000;
    const retries = options.retries ?? 3;
    const failed: Array<BulkFailedItem<TDocument>> = [];
    let succeeded = 0;

    for (let start = 0; start < docs.length; start += chunkSize) {
      const chunk = docs.slice(start, start + chunkSize);
      const result = await this.bulkIndexChunk(chunk, retries, options);
      succeeded += result.succeeded;
      failed.push(...result.failed);
    }

    const result = {
      total: docs.length,
      succeeded,
      failed,
    };

    if (options.throwOnFailure === true && failed.length > 0) {
      throw new BulkPartialFailureError(`Bulk index failed for ${String(failed.length)} document(s).`);
    }

    return result;
  }

  async search(options: EsSearchOptions<TDocument> = {}): Promise<EsSearchResult<TDocument>> {
    const request: estypes.SearchRequest = {
      index: this.indexName,
    };

    if (options.query !== undefined) {
      request.query = options.query;
    }

    if (options.sort !== undefined) {
      request.sort = options.sort as estypes.Sort;
    }

    if (options.size !== undefined) {
      request.size = options.size;
    }

    if (options.from !== undefined) {
      request.from = options.from;
    }

    if (options.after !== undefined) {
      request.search_after = [...options.after] as estypes.SortResults;
    }

    const response = await this.raw.search<TDocument>(request);

    return this.mapSearchResponse(response);
  }

  async searchTemplate(
    id: string,
    params: Record<string, unknown>,
    options: Pick<EsSearchOptions<TDocument>, 'size' | 'from'> = {},
  ): Promise<EsSearchResult<TDocument>> {
    const request: estypes.SearchTemplateRequest = {
      index: this.indexName,
      id,
      params,
    };

    if (options.size !== undefined || options.from !== undefined) {
      request.params = {
        ...params,
        size: options.size,
        from: options.from,
      };
    }

    const response = await this.raw.searchTemplate<TDocument>(request);

    return this.mapSearchResponse(response);
  }

  async searchAfter(options: EsSearchOptions<TDocument>): Promise<EsSearchAfterResult<TDocument>> {
    const result = await this.search(options);
    const lastHit = result.rawHits.at(-1);

    const response: EsSearchAfterResult<TDocument> = {
      ...result,
    };

    if (lastHit?.sort !== undefined) {
      response.nextCursor = lastHit.sort;
    }

    return response;
  }

  async openPit(keepAlive: string = '1m'): Promise<string> {
    const response = await this.raw.openPointInTime({
      index: this.indexName,
      keep_alive: keepAlive,
    });
    return response.id;
  }

  async closePit(pitId: string): Promise<void> {
    await this.raw.closePointInTime({ id: pitId });
  }

  async *scanAll(options: EsScanOptions<TDocument> = {}): AsyncGenerator<TDocument[], void, unknown> {
    const batchSize = options.batchSize ?? 1000;
    const keepAlive = options.keepAlive ?? '1m';
    const sort: estypes.Sort = options.sort !== undefined
      ? ([...options.sort, { _shard_doc: 'asc' }] as estypes.Sort)
      : ([{ _doc: 'asc' }, { _shard_doc: 'asc' }] as estypes.Sort);

    const pitId = await this.openPit(keepAlive);
    let searchAfter: estypes.SortResults | undefined;
    let done = false;

    try {
      while (!done) {
        const request: estypes.SearchRequest = {
          pit: { id: pitId, keep_alive: keepAlive },
          sort,
          size: batchSize,
          ...(options.query !== undefined ? { query: options.query } : {}),
          ...(searchAfter !== undefined ? { search_after: searchAfter } : {}),
        };

        const response = await this.raw.search<TDocument>(request);
        const hits = response.hits.hits.filter(
          (hit): hit is estypes.SearchHit<TDocument> & { _source: TDocument } => hit._source !== undefined,
        );

        if (hits.length === 0) {
          done = true;
        } else {
          yield hits.map((hit) => hit._source);

          const lastSort = hits.at(-1)?.sort;
          if (hits.length < batchSize || lastSort === undefined) {
            done = true;
          } else {
            searchAfter = lastSort;
          }
        }
      }
    } finally {
      await this.closePit(pitId).catch(() => undefined);
    }
  }

  async aggregate<TAggregations extends Record<string, estypes.AggregationsAggregationContainer>>(
    aggregations: TAggregations,
    options: { query?: Record<string, unknown> } = {},
  ): Promise<Record<keyof TAggregations, unknown>> {
    const response = await this.raw.search<TDocument>({
      index: this.indexName,
      query: options.query,
      aggregations,
      size: 0,
    });

    return (response.aggregations ?? {}) as Record<keyof TAggregations, unknown>;
  }

  private async bulkIndexChunk(
    docs: readonly TDocument[],
    retries: number,
    options: BulkIndexOptions<TDocument>,
  ): Promise<Pick<BulkResult<TDocument>, 'succeeded' | 'failed'>> {
    let attempt = 0;
    let pending = [...docs];
    const failed: Array<BulkFailedItem<TDocument>> = [];
    let succeeded = 0;

    while (pending.length > 0) {
      const request: estypes.BulkRequest = {
        operations: pending.flatMap((doc) => {
          const action: { index: { _index: string; _id?: string } } = {
            index: {
              _index: this.indexName,
            },
          };
          const id = options.idSelector?.(doc);

          if (id !== undefined) {
            action.index._id = id;
          }

          return [action, doc];
        }),
      };

      if (options.refresh !== undefined) {
        request.refresh = options.refresh;
      }

      const response = await this.raw.bulk(request);

      if (!response.errors) {
        succeeded += pending.length;
        break;
      }

      const retryable: TDocument[] = [];

      response.items.forEach((item, index) => {
        const operation = item.index;
        const doc = pending[index];

        if (doc === undefined) {
          return;
        }

        if (operation?.error === undefined) {
          succeeded += 1;
          return;
        }

        if ((operation.status === 429 || operation.status === 503) && attempt < retries) {
          retryable.push(doc);
          return;
        }

        failed.push({
          doc,
          status: operation.status,
          error: operation.error,
        });
      });

      pending = retryable;
      attempt += 1;

      if (pending.length > 0) {
        await this.sleep(100 * 2 ** (attempt - 1));
      }
    }

    return { succeeded, failed };
  }

  private mapSearchResponse(response: estypes.SearchResponse<TDocument>): EsSearchResult<TDocument> {
    const rawHits = response.hits.hits
      .filter((hit): hit is estypes.SearchHit<TDocument> & { _source: TDocument } => hit._source !== undefined)
      .map((hit) => {
        const mapped = {
          id: hit._id ?? '',
          source: hit._source,
        } satisfies { id: string; source: TDocument };

        return {
          ...mapped,
          ...(hit._score !== undefined && hit._score !== null ? { score: hit._score } : {}),
          ...(hit.sort !== undefined ? { sort: hit.sort } : {}),
        };
      });

    const total = typeof response.hits.total === 'number' ? response.hits.total : (response.hits.total?.value ?? 0);

    return {
      hits: rawHits.map((hit) => hit.source),
      total,
      rawHits,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
