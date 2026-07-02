import type { Client, ClientOptions } from '@elastic/elasticsearch';
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

export type EsSort<TDocument extends object> = Array<Partial<Record<Extract<keyof TDocument, string>, 'asc' | 'desc'>>>;

export interface EsSearchOptions<TDocument extends object> {
  query?: Record<string, unknown>;
  sort?: EsSort<TDocument>;
  size?: number;
  from?: number;
  after?: readonly unknown[];
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

export type EsClient = Client;
