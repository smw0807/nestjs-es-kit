import type { Client, ClientOptions, estypes } from '@elastic/elasticsearch';
import type { DynamicModule, Type } from '@nestjs/common';

export type EsDocumentClass<TDocument extends object = object> = Type<TDocument>;

export type EsSynchronizeMode = 'none' | 'create' | 'sync';

export interface EsKitModuleOptions extends ClientOptions {
  synchronize?: EsSynchronizeMode;
  logger?: boolean;
}

export interface EsKitModuleAsyncOptions {
  imports?: DynamicModule['imports'];
  inject?: Array<string | symbol | Type<unknown>>;
  useFactory: (...args: readonly unknown[]) => EsKitModuleOptions | Promise<EsKitModuleOptions>;
}

/**
 * Elasticsearch `dynamic` 매핑 파라미터.
 * - `true`: 새 필드 자동 매핑 (기본값)
 * - `false`: 새 필드 무시 (`_source`에는 저장, 검색 불가)
 * - `'strict'`: 새 필드가 포함된 문서 색인 거부 (예외 발생)
 * - `'runtime'`: 새 필드를 runtime field로 추가
 */
export type EsDynamicMode = true | false | 'strict' | 'runtime';

export interface EsIndexOptions {
  name: string;
  useAlias?: boolean;
  version?: number;
  settings?: EsIndexSettings;
  dynamicTemplates?: EsDynamicTemplate[];
  /**
   * 인덱스 레벨 dynamic 매핑 설정.
   * `'strict'`로 설정하면 선언되지 않은 새 필드가 포함된 문서를 거부합니다.
   * @default true (ES 기본값)
   */
  dynamic?: EsDynamicMode;
}

export interface EsIndexSettings {
  numberOfShards?: number;
  numberOfReplicas?: number;
  analysis?: Record<string, unknown>;
  refreshInterval?: string;
}

export interface EsDynamicTemplate {
  name: string;
  matchMappingType?: string;
  match?: string;
  unmatch?: string;
  mapping: EsFieldMapping;
}

export type EsFieldType =
  | 'keyword'
  | 'text'
  | 'integer'
  | 'long'
  | 'float'
  | 'double'
  | 'boolean'
  | 'date'
  | 'object'
  | 'nested'
  | 'ip'
  | 'geo_point';

export interface EsFieldOptions {
  type: EsFieldType;
  analyzer?: string;
  searchAnalyzer?: string;
  fields?: Record<string, EsFieldMapping>;
  index?: boolean;
  docValues?: boolean;
  nullValue?: string | number | boolean;
  format?: string;
  properties?: () => EsDocumentClass;
  /**
   * `object` / `nested` 필드 레벨 dynamic 매핑 설정.
   * 특정 중첩 객체에만 `'strict'`를 적용할 때 사용합니다.
   */
  dynamic?: EsDynamicMode;
}

export interface EsFieldMetadata extends EsFieldOptions {
  propertyKey: string;
}

export type EsFieldMapping = {
  type: EsFieldType;
  analyzer?: string;
  search_analyzer?: string;
  fields?: Record<string, EsFieldMapping>;
  index?: boolean;
  doc_values?: boolean;
  null_value?: string | number | boolean;
  format?: string;
  properties?: Record<string, EsFieldMapping>;
  dynamic?: EsDynamicMode;
};

export interface EsSchema {
  index: string;
  alias: string;
  useAlias: boolean;
  settings?: Record<string, unknown>;
  mappings: {
    dynamic?: EsDynamicMode;
    dynamic_templates?: Array<Record<string, Omit<EsDynamicTemplate, 'name'>>>;
    properties: Record<string, EsFieldMapping>;
  };
}

/** Per-field sort options (order, mode, missing, nested). */
export interface EsSortFieldOptions {
  order?: 'asc' | 'desc';
  mode?: 'min' | 'max' | 'sum' | 'avg' | 'median';
  missing?: string | number;
  nested?: { path: string; filter?: estypes.QueryDslQueryContainer };
}

/**
 * Sort expression for a single sort clause.
 * - `{ field: 'asc' | 'desc' }` — simple order
 * - `{ field: EsSortFieldOptions }` — extended options
 * - `{ _score: 'desc' }` / `{ _doc: 'asc' }` — meta fields
 */
export type EsSortClause<TDocument extends object> =
  | Partial<Record<Extract<keyof TDocument, string>, 'asc' | 'desc' | EsSortFieldOptions>>
  | { _score?: 'asc' | 'desc' }
  | { _doc?: 'asc' | 'desc' };

/** @deprecated Use `EsSortClause<TDocument>[]` or `EsSort` alias. */
export type EsSort<TDocument extends object> = Array<Partial<Record<Extract<keyof TDocument, string>, 'asc' | 'desc'>>>;

export interface EsSearchOptions<TDocument extends object> {
  query?: estypes.QueryDslQueryContainer;
  sort?: Array<EsSortClause<TDocument>>;
  size?: number;
  from?: number;
  after?: readonly unknown[];
}

export interface EsScanOptions<TDocument extends object> {
  /** ES query DSL — defaults to match_all */
  query?: estypes.QueryDslQueryContainer;
  /**
   * Sort for deterministic ordering. Defaults to `[{ _doc: 'asc' }]`.
   * `_shard_doc` tiebreaker is added automatically.
   */
  sort?: Array<EsSortClause<TDocument>>;
  /** Documents per page. Default 1000. */
  batchSize?: number;
  /** PIT keep-alive duration. Default '1m'. */
  keepAlive?: string;
}

export interface EsSearchHit<TDocument extends object> {
  id: string;
  score?: number;
  source: TDocument;
  sort?: readonly unknown[];
}

export interface EsSearchResult<TDocument extends object> {
  hits: TDocument[];
  total: number;
  rawHits: EsSearchHit<TDocument>[];
}

export interface EsSearchAfterResult<TDocument extends object> extends EsSearchResult<TDocument> {
  nextCursor?: readonly unknown[];
}

export interface BulkIndexOptions<TDocument extends object> {
  chunkSize?: number;
  retries?: number;
  refresh?: boolean | 'wait_for';
  idSelector?: (doc: TDocument) => string;
  throwOnFailure?: boolean;
}

export interface BulkFailedItem<TDocument extends object> {
  doc: TDocument;
  status?: number;
  error: unknown;
}

export interface BulkResult<TDocument extends object> {
  total: number;
  succeeded: number;
  failed: Array<BulkFailedItem<TDocument>>;
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface SettingChange {
  setting: string;
  before: unknown;
  after: unknown;
}

export interface SchemaDiff {
  addedFields: string[];
  changedFields: FieldChange[];
  removedFields: string[];
  settingsChanges: SettingChange[];
  isBreaking: boolean;
}

// ─── Aggregation type inference ──────────────────────────────────────────────

/** `terms` / `significant_terms` 집계의 버킷 타입. */
export interface TermsBucket {
  key: string | number;
  key_as_string?: string;
  doc_count: number;
}

/** `date_histogram` 집계의 버킷 타입. */
export interface DateHistogramBucket {
  key: number;
  key_as_string: string;
  doc_count: number;
}

/** `range` / `date_range` 집계의 버킷 타입. */
export interface RangeBucket {
  key: string;
  doc_count: number;
  from?: number;
  from_as_string?: string;
  to?: number;
  to_as_string?: string;
}

/**
 * 집계 컨테이너 정의로부터 응답 타입을 추론합니다.
 * 알 수 없는 집계 타입은 `unknown`으로 폴백합니다.
 */
export type AggregationResult<T extends estypes.AggregationsAggregationContainer> =
  T extends { terms: unknown } | { significant_terms: unknown }
    ? { buckets: TermsBucket[] }
    : T extends { date_histogram: unknown }
      ? { buckets: DateHistogramBucket[] }
      : T extends { range: unknown } | { date_range: unknown } | { ip_range: unknown }
        ? { buckets: RangeBucket[] }
        : T extends { avg: unknown } | { min: unknown } | { max: unknown } | { sum: unknown } | { median_absolute_deviation: unknown }
          ? { value: number | null }
          : T extends { value_count: unknown } | { cardinality: unknown }
            ? { value: number }
            : T extends { top_hits: unknown }
              ? { hits: { total: { value: number }; hits: estypes.SearchHit[] } }
              : unknown;

/**
 * 집계 정의 맵 전체의 응답 타입을 추론합니다.
 *
 * @example
 * ```ts
 * const aggs = await service.aggregate({
 *   byCategory: { terms: { field: 'category' } },
 *   avgPrice:   { avg:   { field: 'price' } },
 * });
 * // aggs.byCategory → { buckets: TermsBucket[] }
 * // aggs.avgPrice   → { value: number | null }
 * ```
 */
export type AggregationsResult<TAggregations extends Record<string, estypes.AggregationsAggregationContainer>> = {
  [K in keyof TAggregations]: AggregationResult<TAggregations[K]>;
};

// ─── Migration ───────────────────────────────────────────────────────────────

export interface MigrateOptions {
  /** Delete the old physical index after alias swap. Default: false */
  deleteOldIndex?: boolean;
}

export interface MigrateResult {
  fromIndex: string;
  toIndex: string;
  documentsReindexed: number;
}

export type EsClient = Client;
