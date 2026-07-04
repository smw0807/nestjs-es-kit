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

export interface EsIndexOptions {
  name: string;
  useAlias?: boolean;
  version?: number;
  settings?: EsIndexSettings;
  dynamicTemplates?: EsDynamicTemplate[];
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
};

export interface EsSchema {
  index: string;
  alias: string;
  useAlias: boolean;
  settings?: Record<string, unknown>;
  mappings: {
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
