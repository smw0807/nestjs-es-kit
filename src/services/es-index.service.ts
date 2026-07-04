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

/**
 * 특정 Elasticsearch 인덱스에 대한 타입 안전 CRUD·검색·집계 서비스.
 * `@InjectIndex(SchemaClass)`로 주입받아 사용합니다.
 */
export class EsIndexService<TDocument extends object> {
  private readonly schemaBuilder = new SchemaBuilder();

  /** 실제 쿼리에 사용되는 인덱스(또는 별칭) 이름 */
  readonly indexName: string;

  constructor(
    /** 원본 `@elastic/elasticsearch` 클라이언트 — 지원하지 않는 API에 직접 접근할 때 사용 */
    readonly raw: Client,
    private readonly target: EsDocumentClass<TDocument>,
  ) {
    const schema = this.schemaBuilder.build(target);
    this.indexName = schema.useAlias ? schema.alias : schema.index;
  }

  /**
   * 문서를 인덱싱(생성 또는 교체)합니다.
   *
   * @param doc - 인덱싱할 문서
   * @param options.id - 문서 ID (생략 시 ES가 자동 생성)
   * @param options.refresh - 인덱싱 후 리프레시 여부 (`true` | `false` | `'wait_for'`)
   * @returns 할당된 문서 ID
   */
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

  /**
   * ID로 문서를 조회합니다.
   *
   * @param id - 문서 ID
   * @returns 문서 또는 `null` (존재하지 않을 때)
   */
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

  /**
   * 문서의 일부 필드를 업데이트합니다 (partial update).
   * 나머지 필드는 변경되지 않습니다.
   *
   * @param id - 업데이트할 문서 ID
   * @param partial - 변경할 필드만 포함한 부분 객체
   * @param options.refresh - 업데이트 후 리프레시 여부
   */
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

  /**
   * ID로 문서를 삭제합니다.
   *
   * @param id - 삭제할 문서 ID
   * @param options.refresh - 삭제 후 리프레시 여부
   */
  async delete(id: string, options: { refresh?: boolean | 'wait_for' } = {}): Promise<void> {
    const request: estypes.DeleteRequest = { index: this.indexName, id };

    if (options.refresh !== undefined) {
      request.refresh = options.refresh;
    }

    await this.raw.delete(request);
  }

  /**
   * 대량 문서를 청크 단위로 인덱싱합니다.
   * HTTP 429/503 응답은 지수 백오프로 재시도합니다.
   *
   * @param docs - 인덱싱할 문서 배열
   * @param options.chunkSize - 청크당 문서 수 (기본 1000)
   * @param options.retries - 재시도 횟수 (기본 3)
   * @param options.refresh - 인덱싱 후 리프레시 여부
   * @param options.idSelector - 문서에서 ID를 추출하는 함수
   * @param options.throwOnFailure - 실패 항목이 있을 때 `BulkPartialFailureError` 발생 여부
   * @returns 성공/실패 건수 및 실패 항목 목록
   */
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

  /**
   * ES Query DSL로 문서를 검색합니다.
   * `query`, `sort`, `size`, `from`, `after`(search_after)를 지원합니다.
   *
   * @param options - 검색 옵션 (query, sort, size, from, after)
   * @returns `hits`(문서 배열), `total`, `rawHits`(id·score·sort 포함)
   */
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

  /**
   * 미리 저장된 검색 템플릿(stored script)으로 검색합니다.
   *
   * @param id - 저장된 템플릿 ID
   * @param params - 템플릿에 전달할 파라미터
   * @param options - 추가 페이지네이션 옵션 (size, from)
   */
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

  /**
   * `search_after` 기반 커서 페이지네이션으로 검색합니다.
   * 결과에 `nextCursor`가 포함되며, 다음 페이지 요청 시 `after`에 전달합니다.
   *
   * @param options - 검색 옵션. 반드시 `sort`를 포함해야 커서가 생성됩니다.
   * @returns 검색 결과 + `nextCursor` (마지막 페이지이면 `undefined`)
   */
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

  /**
   * Point-in-Time(PIT)을 열고 ID를 반환합니다.
   * PIT는 스냅샷 기반으로 일관된 페이지네이션을 보장합니다.
   *
   * @param keepAlive - PIT 유지 시간 (기본 `'1m'`)
   * @returns PIT ID — `closePit()` 또는 `scanAll()`에 사용
   */
  async openPit(keepAlive: string = '1m'): Promise<string> {
    const response = await this.raw.openPointInTime({
      index: this.indexName,
      keep_alive: keepAlive,
    });
    return response.id;
  }

  /**
   * 열린 Point-in-Time을 닫아 서버 리소스를 해제합니다.
   *
   * @param pitId - `openPit()`이 반환한 PIT ID
   */
  async closePit(pitId: string): Promise<void> {
    await this.raw.closePointInTime({ id: pitId });
  }

  /**
   * PIT + `search_after`로 전체 문서를 배치 단위로 순회하는 async generator입니다.
   * PIT는 내부에서 자동으로 열고 닫습니다 (오류 발생 시에도 `finally`로 정리).
   *
   * @example
   * ```ts
   * for await (const batch of service.scanAll({ batchSize: 500 })) {
   *   await processDocuments(batch);
   * }
   * ```
   *
   * @param options.query - ES Query DSL (기본: `match_all`)
   * @param options.sort - 정렬 기준 (기본: `[{ _doc: 'asc' }]`)
   * @param options.batchSize - 페이지당 문서 수 (기본: 1000)
   * @param options.keepAlive - PIT 유지 시간 (기본: `'1m'`)
   * @yields 한 페이지 분량의 문서 배열
   */
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

  /**
   * 집계(aggregation)를 실행합니다.
   * `size: 0`으로 문서는 반환하지 않고 집계 결과만 반환합니다.
   *
   * @param aggregations - ES 집계 정의 객체
   * @param options.query - 집계 전 적용할 필터 쿼리
   * @returns 집계 결과 (`TAggregations`의 키를 그대로 유지)
   */
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

  /**
   * 단일 청크에 대해 Bulk 인덱싱을 수행합니다.
   * 429/503 응답은 지수 백오프로 재시도하고, 그 외 오류는 실패 목록에 추가합니다.
   */
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

  /** ES 검색 응답을 `EsSearchResult` 형태로 변환합니다. */
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

  /** 지정된 시간(ms)만큼 대기합니다. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
