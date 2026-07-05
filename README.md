# nestjs-es-kit

> Decorator-driven Elasticsearch index lifecycle management for NestJS

[![npm version](https://badge.fury.io/js/nestjs-es-kit.svg)](https://badge.fury.io/js/nestjs-es-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 한국어 문서: [README.ko.md](https://github.com/smw0807/nestjs-es-kit/blob/main/README.ko.md)

Declare your Elasticsearch schema once as a decorated TypeScript class — `nestjs-es-kit` handles index creation, mapping synchronization, and breaking-change detection automatically at application bootstrap.

```ts
@EsIndex({ name: 'products', settings: { analysis: koreanAnalysis() } })
class Product {
  @EsField({ type: 'keyword' }) id: string;
  @EsField({ type: 'text', analyzer: 'nori_analyzer' }) name: string;
  @EsField({ type: 'integer' }) price: number;
}
```

## What's new in 1.0.2

- Safer zero-downtime migrations: aliases are swapped only after `reindex` completes without failures, timeouts, or version conflicts.
- `scanAll()` now follows Elasticsearch's refreshed PIT IDs and closes the latest PIT to avoid stale cursor errors on long scans.
- Recursive object/nested mapping diff: safe additions such as `seller.rating` are synced without forcing a reindex.
- `@InjectIndex()` provider tokens are now schema-identity based, preventing collisions between classes with the same name.
- CLI config validation now reports clear errors for missing `schemas`, invalid schema entries, and malformed `migrateOptions`.

---

## Why nestjs-es-kit?

The official `@nestjs/elasticsearch` (~131k weekly downloads) wraps the ES client for DI — nothing more. Every team ends up writing the same boilerplate across projects:

| What you repeat                                                | nestjs-es-kit                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| JSON mapping files disconnected from your TypeScript types     | Decorator schema — one source of truth                      |
| Bootstrap code to check and create indices                     | `synchronize: 'create'`                                     |
| Manual `put_mapping` for new fields, including nested additions | `synchronize: 'sync'` with recursive mapping diff            |
| Figuring out which mapping changes need a full reindex         | `diff()` + `BreakingSchemaChangeError` with a clear message |
| Chunk splitting, retry logic, partial failure parsing for bulk | `bulkIndex()`                                               |

**Competitive landscape (npm, 2026-07)**

| Package                             | Weekly DL | Status         | Scope                                    |
| ----------------------------------- | --------- | -------------- | ---------------------------------------- |
| @nestjs/elasticsearch               | ~131,000  | Active         | DI wrapper only                          |
| @codemask-labs/nestjs-elasticsearch | ~70       | Active         | Query type safety                        |
| es-mapping-ts                       | ~3,000    | Abandoned 2020 | Decorator mapping (ES 6/7)               |
| elasticsearch-index-migrate         | ~1,000    | Abandoned 2022 | Migration CLI                            |
| **nestjs-es-kit**                   | —         | **Active**     | **Index lifecycle + Korean nori preset** |

---

## Installation

```bash
npm install nestjs-es-kit
# peer dependencies
npm install @elastic/elasticsearch @nestjs/common @nestjs/core reflect-metadata
```

Enable decorator metadata in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

---

## Quick Start

### 1. Declare a schema

```ts
// product.schema.ts
import { EsIndex, EsField, koreanAnalysis } from 'nestjs-es-kit';

@EsIndex({
  name: 'products',
  useAlias: true, // creates products-v1 + alias 'products' (default: true)
  settings: {
    numberOfShards: 3,
    numberOfReplicas: 1,
    analysis: koreanAnalysis(),
  },
  dynamicTemplates: [
    {
      name: 'strings_as_keyword',
      matchMappingType: 'string',
      mapping: { type: 'keyword' },
    },
  ],
})
export class Product {
  @EsField({ type: 'keyword' })
  id: string;

  @EsField({
    type: 'text',
    analyzer: 'nori_analyzer',
    fields: { raw: { type: 'keyword' } }, // multi-field
  })
  name: string;

  @EsField({ type: 'integer' })
  price: number;

  @EsField({ type: 'date' })
  createdAt: Date;

  @EsField({ type: 'object', properties: () => Seller })
  seller?: Seller;
}
```

### 2. Register the module

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EsKitModule } from 'nestjs-es-kit';
import { ProductModule } from './product/product.module';

@Module({
  imports: [
    ConfigModule.forRoot(),
    EsKitModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        node: config.get('ES_NODE'),
        auth: {
          username: config.get('ES_USERNAME'),
          password: config.get('ES_PASSWORD'),
        },
        synchronize: 'sync', // 'none' | 'create' | 'sync'
      }),
      inject: [ConfigService],
    }),
    ProductModule,
  ],
})
export class AppModule {}

// product.module.ts
@Module({
  imports: [EsKitModule.forFeature([Product])],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}
```

### 3. Use in your service

```ts
// product.service.ts
import { Injectable } from '@nestjs/common';
import { InjectIndex, EsIndexService } from 'nestjs-es-kit';
import { Product } from './product.schema';

@Injectable()
export class ProductService {
  constructor(
    @InjectIndex(Product) private readonly products: EsIndexService<Product>,
  ) {}

  async create(dto: CreateProductDto) {
    return this.products.index(dto, { id: dto.id, refresh: 'wait_for' });
  }

  async findById(id: string) {
    return this.products.get(id);
  }

  async search(keyword: string) {
    return this.products.search({
      query: { match: { name: keyword } },
      sort: [{ createdAt: 'desc' }],
      size: 20,
    });
  }
}
```

---

## API Reference

### Decorators

#### `@EsIndex(options)`

| Option             | Type                              | Default  | Description                                                                                                    |
| ------------------ | --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `name`             | `string`                          | required | Index base name. Physical index: `{name}-v1` when `useAlias: true`                                             |
| `useAlias`         | `boolean`                         | `true`   | Create a physical index `{name}-v{version}` and an alias `{name}`                                              |
| `version`          | `number`                          | `1`      | Current schema version (used for physical index naming)                                                        |
| `settings`         | `EsIndexSettings`                 | —        | `numberOfShards`, `numberOfReplicas`, `refreshInterval`, `analysis`                                            |
| `dynamicTemplates` | `EsDynamicTemplate[]`             | —        | ES [dynamic templates](https://www.elastic.co/guide/en/elasticsearch/reference/current/dynamic-templates.html) |
| `dynamic`          | `true \| false \| 'strict' \| 'runtime'` | `true` (ES default) | Controls how unknown fields in documents are handled (see [Dynamic mapping](#dynamic-mapping)) |

#### `@EsField(options)`

| Option           | Type                              | Description                                                                                             |
| ---------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `type`           | `EsFieldType`                     | `keyword` `text` `integer` `long` `float` `double` `boolean` `date` `object` `nested` `ip` `geo_point` |
| `analyzer`       | `string`                          | Index-time analyzer                                                                                     |
| `searchAnalyzer` | `string`                          | Search-time analyzer (defaults to `analyzer`)                                                           |
| `fields`         | `Record<string, EsFieldMapping>`  | Multi-fields (e.g., `.raw` keyword sub-field)                                                           |
| `index`          | `boolean`                         | Disable indexing for a field                                                                            |
| `docValues`      | `boolean`                         | Disable doc values                                                                                      |
| `nullValue`      | `string \| number \| boolean`     | Substitute for `null` during indexing                                                                   |
| `format`         | `string`                          | Date format string                                                                                      |
| `properties`     | `() => Class`                     | Nested/object class reference (lazy to avoid circular imports)                                          |
| `dynamic`        | `true \| false \| 'strict' \| 'runtime'` | Per-field dynamic mapping for `object`/`nested` types                                          |

#### `@InjectIndex(SchemaClass)`

DI token for injecting `EsIndexService<T>` in a constructor.

---

### Module

#### `EsKitModule.forRoot(options)`

```ts
EsKitModule.forRoot({
  node: 'http://localhost:9200',
  auth: { username: 'elastic', password: '...' },
  synchronize: 'create', // default
  logger: true,
});
```

All options extend `@elastic/elasticsearch` `ClientOptions` — the ES client receives them directly.

**nestjs-es-kit specific options:**

| Option        | Type              | Default     | Description                                                    |
| ------------- | ----------------- | ----------- | -------------------------------------------------------------- |
| `synchronize` | `EsSynchronizeMode` | `'create'` | Index synchronization strategy at bootstrap (see [synchronize Modes](#synchronize-modes)) |
| `logger`      | `boolean`         | `false`     | Log index create / migrate / settings-update events via NestJS `Logger` |

#### `EsKitModule.forRootAsync(options)`

```ts
EsKitModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    node: config.get('ES_NODE'),
    synchronize: config.get<string>('ES_SYNC', 'create'),
  }),
  inject: [ConfigService],
});
```

#### `EsKitModule.forFeature(schemas)`

```ts
EsKitModule.forFeature([Product, Order]);
```

Registers `EsIndexService<T>` providers for each schema and triggers synchronization at module init.

---

### `synchronize` Modes

Synchronization runs automatically at application bootstrap for every schema registered via `forFeature`.

| Mode       | Behavior                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'none'`   | Does nothing. Manage indices yourself.                                                                                                                                          |
| `'create'` | Creates the index if it does not exist. No-op if it already exists. **(default)**                                                                                               |
| `'sync'`   | Creates if missing. Detects mapping and settings changes: adds new top-level and object/nested fields via `PUT /_mapping`, applies dynamic settings via `PUT /_settings`, throws `BreakingSchemaChangeError` for breaking changes. |

**`'sync'` detects two categories of settings changes:**

| Setting | Category | Action |
|---------|----------|--------|
| `number_of_replicas`, `refresh_interval`, etc. | Dynamic | Auto-applied via `PUT /{index}/_settings` |
| `number_of_shards`, `analysis` | Static | Throws `BreakingSchemaChangeError` — reindex required |

**When to use each mode**

- **Development**: `'sync'` — automatically picks up new fields.
- **Production (stable schema)**: `'create'` — safe, no surprise mutations.
- **Production (controlled migration)**: `'none'` + `EsIndexManager` in your deployment script.

---

### `EsIndexService<T>`

Inject with `@InjectIndex(SchemaClass)`.

#### Document operations

```ts
// Index (create or replace)
const id = await this.products.index(doc, { id: doc.id, refresh: 'wait_for' });

// Get by ID
const doc = await this.products.get('product-1'); // null if not found

// Partial update
await this.products.update(
  'product-1',
  { price: 9900 },
  { refresh: 'wait_for' },
);

// Delete
await this.products.delete('product-1');
```

#### Bulk index

```ts
const result = await this.products.bulkIndex(docs, {
  chunkSize: 1000, // default 1000
  retries: 3, // retries 429/503 with exponential backoff
  refresh: false,
  idSelector: (doc) => doc.id,
  throwOnFailure: false, // set true to throw BulkPartialFailureError on any failure
});

result.total; // total document count
result.succeeded; // successfully indexed count
result.failed; // BulkFailedItem[] — { doc, error, status }
```

#### Search

```ts
// Basic search — _source is typed as T[]
const result = await this.products.search({
  query: { match: { name: '노트북' } },
  sort: [{ createdAt: 'desc' }],
  size: 20,
  from: 0,
});

result.hits; // Product[]
result.total; // number
result.rawHits; // { id, score, source, sort }[]

// search_template
const result = await this.products.searchTemplate('product-search', {
  keyword: '노트북',
});

// search_after (cursor pagination)
const page = await this.products.searchAfter({
  query: { match_all: {} },
  sort: [{ createdAt: 'desc' }, { id: 'asc' }],
  size: 20,
  after: prevPage.nextCursor, // omit for first page
});
page.nextCursor; // pass to the next call

// scan all — async generator via Point-in-Time (large dataset iteration)
for await (const batch of this.products.scanAll({
  query: { term: { category: 'electronics' } },
  sort: [{ createdAt: 'asc' }],
  batchSize: 1000,
  keepAlive: '1m',
})) {
  await processInBatch(batch); // batch: Product[]
}
```

#### Aggregations

Response types are inferred automatically from the aggregation definition:

```ts
const aggs = await this.products.aggregate(
  {
    byCategory: { terms: { field: 'category', size: 10 } },
    avgPrice:   { avg:   { field: 'price' } },
    totalCount: { value_count: { field: 'id' } },
  },
  { query: { range: { price: { gte: 10000 } } } }, // optional pre-filter
);

// TypeScript infers:
aggs.byCategory.buckets;       // TermsBucket[]   — { key, doc_count }[]
aggs.avgPrice.value;           // number | null
aggs.totalCount.value;         // number
```

Supported aggregation → result type mappings:

| Aggregation | Result type |
|-------------|-------------|
| `terms`, `significant_terms` | `{ buckets: TermsBucket[] }` |
| `avg`, `min`, `max`, `sum`, `median_absolute_deviation` | `{ value: number \| null }` |
| `value_count`, `cardinality` | `{ value: number }` |
| `date_histogram` | `{ buckets: DateHistogramBucket[] }` |
| `range`, `date_range`, `ip_range` | `{ buckets: RangeBucket[] }` |
| `top_hits` | `{ hits: { total: ...; hits: SearchHit[] } }` |
| Other | `unknown` |

#### Point-in-Time (PIT) helpers

```ts
// Manual PIT control (advanced use-cases)
const pitId = await this.products.openPit('5m');
// ... multiple search_after calls reusing the same PIT ...
await this.products.closePit(pitId);

// scanAll — async generator, opens/closes PIT automatically
for await (const batch of this.products.scanAll({ batchSize: 500 })) {
  await processInBatch(batch); // batch: Product[]
}
```

`scanAll()` tracks the refreshed `pit_id` returned by Elasticsearch on every page and closes the latest PIT id when iteration ends.

`scanAll` options:

| Option      | Type                            | Default       |
| ----------- | ------------------------------- | ------------- |
| `query`     | `QueryDslQueryContainer`        | `match_all`   |
| `sort`      | `EsSortClause[]`                | `[{_doc:'asc'}]` |
| `batchSize` | `number`                        | `1000`        |
| `keepAlive` | `string`                        | `'1m'`        |

#### Raw escape hatch

```ts
this.products.raw; // @elastic/elasticsearch Client — full API access
this.products.indexName; // alias name when useAlias: true, physical name otherwise
```

---

### `EsIndexManager`

Injected as-is — no `@InjectIndex` needed.

```ts
constructor(private readonly indexManager: EsIndexManager) {}

await this.indexManager.exists(Product);
await this.indexManager.create(Product);
await this.indexManager.delete(Product, { force: true });  // force required
await this.indexManager.syncMapping(Product);
await this.indexManager.diff(Product);
await this.indexManager.migrate(ProductV2);              // zero-downtime reindex
await this.indexManager.migrate(ProductV2, { deleteOldIndex: true }); // + remove old index
```

#### `migrate()`

Zero-downtime alias-swap reindex from the current physical index to the next version.

```ts
// 1. Update @EsIndex version
@EsIndex({ name: 'products', version: 2 })
class ProductV2 { ... }

// 2. In a deploy script or NestJS bootstrap hook
const result = await indexManager.migrate(ProductV2, { deleteOldIndex: false });
// result.fromIndex       → 'products-v1'
// result.toIndex         → 'products-v2'
// result.documentsReindexed → number
```

Requirements:
- `useAlias: true` must be set on `@EsIndex`
- The alias must already exist (created by `synchronize: 'create'` or `'sync'`)
- The version in `@EsIndex` must be incremented from the currently active index

Throws `MigrationError` if the alias doesn't exist, `useAlias` is false, or the target version is already active.

`migrate()` validates the `reindex` response before swapping aliases. If Elasticsearch reports failures, timeout, or version conflicts, the new index is deleted and the alias remains on the previous index.

#### `SchemaDiff`

```ts
const diff = await this.indexManager.diff(Product);

diff.addedFields;    // string[]       — safe to put_mapping; nested additions use dotted paths like 'seller.rating'
diff.changedFields;  // FieldChange[]  — type/analyzer changed → reindex required
diff.removedFields;  // string[]       — informational (ES never deletes fields)
diff.settingsChanges; // SettingChange[] — changed settings ({ setting, before, after })
diff.isBreaking;     // boolean — true when changedFields or static settings (number_of_shards, analysis) changed
```

---

### Korean Analysis — `koreanAnalysis()`

Requires the [`analysis-nori`](https://www.elastic.co/guide/en/elasticsearch/plugins/current/analysis-nori.html) plugin:

```sh
bin/elasticsearch-plugin install analysis-nori
# Docker: add to a custom Dockerfile
# FROM docker.elastic.co/elasticsearch/elasticsearch:8.18.2
# RUN elasticsearch-plugin install --batch analysis-nori
```

```ts
import { koreanAnalysis } from 'nestjs-es-kit';

@EsIndex({
  name: 'articles',
  settings: {
    analysis: koreanAnalysis({
      decompound: 'mixed',           // 'none' | 'discard' | 'mixed' (default)
      stoptags: ['IC', 'SP'],        // POS tags — ES 9.x: fine-grained Sejong tags; ES 8.x: 'J','E'
      synonyms: ['노트북,랩탑'],      // synonym list — creates nori_search_analyzer automatically
      userDictionaryRules: [         // inline user dictionary rules
        '삼성전자',
        'LG전자',
        '카카오 카카오',              // '단어 분해1 분해2' format for custom segmentation
      ],
    }),
  },
})
class Article {
  @EsField({ type: 'text', analyzer: 'nori_analyzer', searchAnalyzer: 'nori_search_analyzer' })
  title: string;
}
```

`koreanAnalysis()` generates:
- `nori_analyzer` — index-time: `nori_tokenizer` + POS filter + `lowercase`
- `nori_search_analyzer` — search-time: adds `synonym_graph` filter before POS filter (only when `synonyms` is set)

> **Note**: Default `stoptags` is empty for ES 8/9 compatibility. ES 9.x (Lucene 10) uses fine-grained Sejong tagset (`JKS`, `EF`, etc.) instead of the aggregated tags (`J`, `E`) used in ES 8.x.

---

### CLI — `npx es-kit`

Run index operations from the command line without starting the full NestJS app. Useful in CI/CD pipelines and deployment scripts.

#### 1. Create a config file

```js
// es-kit.config.js  (ESM, committed to your repo)
import { ProductV2 } from './dist/product.schema.js';
import { Order } from './dist/order.schema.js';

export default {
  node: process.env.ES_NODE ?? 'http://localhost:9200',
  auth: {
    username: process.env.ES_USERNAME ?? 'elastic',
    password: process.env.ES_PASSWORD ?? '',
  },
  schemas: [ProductV2, Order],
  migrateOptions: { deleteOldIndex: false }, // default options for the migrate command
};
```

> The config file imports from your **compiled** output (`dist/`). Run your TypeScript build first.
> The CLI validates that `schemas` is a non-empty array of schema classes before connecting to Elasticsearch.

#### 2. Run commands

```bash
# Show mapping and settings differences for all schemas
npx es-kit diff --config ./es-kit.config.js

# Apply mappings/settings changes (throws on breaking changes)
npx es-kit sync --config ./es-kit.config.js

# Create indices that do not exist yet
npx es-kit create --config ./es-kit.config.js

# Zero-downtime alias-swap reindex (requires useAlias: true)
npx es-kit migrate --config ./es-kit.config.js
npx es-kit migrate --config ./es-kit.config.js --delete-old  # also remove old index
```

`diff` exits with code 1 when breaking changes are detected. `sync` exits with code 1 if a breaking change would be applied.

---

### Standalone Manager

Use `EsStandaloneManager` when you need programmatic control outside of a NestJS application context:

```ts
import { EsStandaloneManager } from 'nestjs-es-kit/standalone';
import { ProductV2 } from './product.schema.js';

const manager = new EsStandaloneManager({
  node: 'http://localhost:9200',
  auth: { username: 'elastic', password: 'secret' },
});

// Check differences
const diff = await manager.diff(ProductV2);
console.log(diff.settingsChanges, diff.isBreaking);

// Zero-downtime migration
const result = await manager.migrate(ProductV2, { deleteOldIndex: true });
// result.fromIndex, result.toIndex, result.documentsReindexed

// Sync (auto-applies dynamic settings, throws on breaking changes)
await manager.sync(ProductV2);
```

`EsStandaloneManager` exposes: `exists`, `create`, `diff`, `sync`, `migrate`.

---

### Dynamic Mapping

The `dynamic` option controls how Elasticsearch handles fields that appear in a document but are **not declared** in the mapping.

| Value | Behavior |
|-------|----------|
| `true` | Auto-map new fields (ES default) |
| `false` | Ignore new fields — stored in `_source` but not searchable |
| `'strict'` | **Reject** documents that contain undeclared fields (exception thrown) |
| `'runtime'` | Add new fields as [runtime fields](https://www.elastic.co/guide/en/elasticsearch/reference/current/runtime.html) |

#### Index-level strict mode

```ts
@EsIndex({
  name: 'products',
  dynamic: 'strict', // reject any document with undeclared fields
})
export class Product {
  @EsField({ type: 'keyword' }) id: string;
  @EsField({ type: 'text' }) name: string;
}
```

Indexing `{ id: '1', name: 'Laptop', unknownField: 'value' }` will throw a `strict_dynamic_mapping_exception`.

#### Per-field strict mode (object / nested)

You can apply `dynamic` selectively to a nested object while leaving the top-level index open:

```ts
@EsIndex({ name: 'orders' })
export class Order {
  @EsField({ type: 'keyword' }) id: string;

  @EsField({
    type: 'object',
    properties: () => Address,
    dynamic: 'strict', // only the nested Address object rejects unknown fields
  })
  address?: Address;
}
```

---

### Why Can't You Change Field Types?

Elasticsearch stores fields in Apache Lucene segments with the type baked in at index time. Changing a field from `text` to `keyword` (or `integer` to `long`) requires rewriting all segments — which ES does not support in-place.

When `synchronize: 'sync'` detects a breaking change, it throws `BreakingSchemaChangeError` at bootstrap to stop a misconfigured deployment early:

```
BreakingSchemaChangeError: Breaking Elasticsearch schema change detected for products:
  name (text → keyword). Reindex migration is required.
```

**The fix**: create a new index (`products-v2`), reindex data, swap the alias. Use `EsIndexManager.migrate()`:

```ts
// Increment version in @EsIndex({ version: 2 }), then:
const result = await indexManager.migrate(ProductV2, { deleteOldIndex: true });
// products-v1 → products-v2, alias 'products' atomically swapped
```

See [`migrate()` docs](#migrate) above for details.

---

### Error Classes

```ts
import {
  EsKitError,             // base class — all errors extend this
  IndexNotFoundError,     // index doesn't exist (synchronize: 'none')
  IndexAlreadyExistsError,
  BreakingSchemaChangeError, // diff.isBreaking — message includes changed field list
  BulkPartialFailureError,   // opt-in: bulkIndex({ throwOnFailure: true })
  SchemaMetadataError,    // decorator misconfiguration (e.g., zero @EsField)
  UnsupportedEsVersionError, // connected to ES < 8
  MigrationError,         // migrate() — alias not found, useAlias: false, version conflict
} from 'nestjs-es-kit';
```

All errors preserve the original ES error as `cause`.

---

### Health Check — `EsHealthIndicator`

Requires [`@nestjs/terminus`](https://docs.nestjs.com/recipes/terminus):

```bash
npm install @nestjs/terminus
```

```ts
// health.module.ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { EsHealthIndicator } from 'nestjs-es-kit/health';

@Module({
  imports: [TerminusModule],
  providers: [EsHealthIndicator],
})
export class HealthModule {}

// health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { EsHealthIndicator } from 'nestjs-es-kit/health';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private es: EsHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.es.isHealthy('elasticsearch'),
    ]);
  }
}
```

Response when healthy:

```json
{
  "status": "ok",
  "info": {
    "elasticsearch": {
      "status": "up",
      "clusterStatus": "green",
      "numberOfNodes": 1,
      "activeShards": 5
    }
  }
}
```

`EsHealthIndicator` uses `GET /_cluster/health` and marks the indicator `down` when the cluster status is `red` or unreachable.

---

## Roadmap

| Version      | Scope                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **v0.1**     | Decorator schema, forRoot/forFeature, synchronize, CRUD, bulk, search, aggregate, nori preset, error hierarchy              |
| **v0.2**     | `migrate()` zero-downtime alias-swap reindex, `EsHealthIndicator` terminus integration, ES 9.x nori compat                  |
| **v0.3**     | `scanAll()` PIT-based async generator, `openPit`/`closePit`, typed query DSL (`QueryDslQueryContainer`), extended sort types, `dynamic` mapping option, settings diff/sync in `synchronize: 'sync'` |
| **v0.4**     | `npx es-kit` CLI (`migrate`/`sync`/`diff`/`create`), `EsStandaloneManager`, per-aggregation response type inference, nori `userDictionaryRules` |
| **v1.0.0** ✓ | Stable release — public API locked, semver enforced from here                                                               |
| **v1.0.2** ✓ | Migration safety checks, latest PIT id tracking, recursive object/nested mapping sync, schema-identity DI tokens, CLI config validation |

---

## License

MIT © [songminwoo](https://github.com/smw0807)
