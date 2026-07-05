# nestjs-es-kit

## 1.0.2

### Patch Changes

- **fix**: harden zero-downtime migrations

  `EsIndexManager.migrate()` now validates the `reindex` response before swapping aliases.
  If Elasticsearch reports failures, timeout, or version conflicts, the new index is cleaned up
  and the alias remains pointed at the previous index.

- **fix**: keep PIT scans on the latest PIT id

  `EsIndexService.scanAll()` now reuses the refreshed `pit_id` returned by each search response
  and closes the latest PIT id, avoiding stale cursor errors and leaked PIT resources on long scans.

- **fix**: support recursive object/nested mapping diffs

  Added fields inside `object` / `nested` properties are now reported as dotted paths
  such as `seller.rating` and synced as non-breaking mapping additions.

- **fix**: prevent `@InjectIndex()` provider token collisions

  Index service provider tokens are now stable per schema class identity instead of relying on
  class names, so two schemas with the same class name in different modules no longer collide.

- **fix**: validate CLI config shape before running commands

  The CLI now reports clear config errors for missing or invalid `schemas`, non-class schema
  entries, and invalid `migrateOptions`.

---

## 1.0.1

### Patch Changes

- **fix**: `EsHealthIndicator` boot failure due to DI token mismatch across bundle chunks

  `Symbol('ES_KIT_CLIENT')` was evaluated separately in `index.cjs` and `health.cjs`,
  producing two distinct symbols that never matched. Changed to `Symbol.for()` which uses
  the global symbol registry and guarantees the same token across all bundle entries.

---

## 1.0.0

### Stable Release

First production-ready release. Public API is now stable — breaking changes will follow semver major bumps.

---

## 0.4.0

### Minor Changes

- **feat**: `npx es-kit` CLI with `migrate` / `sync` / `diff` / `create` commands

  Point at a config file and run index operations without starting the full NestJS app.
  Useful in CI/CD pipelines and deployment scripts.

  ```bash
  npx es-kit diff   --config ./es-kit.config.js
  npx es-kit sync   --config ./es-kit.config.js
  npx es-kit migrate --config ./es-kit.config.js --delete-old
  npx es-kit create --config ./es-kit.config.js
  ```

- **feat**: `EsStandaloneManager` — subpath `nestjs-es-kit/standalone`

  Wraps `EsIndexManager` without NestJS DI. Use in migration scripts, one-off jobs, or tests.

  ```ts
  import { EsStandaloneManager } from 'nestjs-es-kit/standalone';
  const manager = new EsStandaloneManager({ node: 'http://localhost:9200' });
  await manager.migrate(ProductV2, { deleteOldIndex: true });
  ```

- **feat**: `AggregationResult<T>` — per-aggregation response type inference

  `EsIndexService.aggregate()` now infers the response type from the aggregation definition.

  ```ts
  const aggs = await service.aggregate({
    byCategory: { terms: { field: 'category' } }, // → { buckets: TermsBucket[] }
    avgPrice:   { avg:   { field: 'price' } },     // → { value: number | null }
  });
  ```

- **feat**: `koreanAnalysis()` — `userDictionaryRules` option

  Inline nori user dictionary rules without an external file.

  ```ts
  koreanAnalysis({ userDictionaryRules: ['삼성전자', '카카오 카카오'] })
  ```

---

## 0.3.1

### Patch Changes

- **feat**: `dynamic` mapping option on `@EsIndex` and `@EsField`

  Controls how Elasticsearch handles undeclared fields in documents.
  `'strict'` rejects documents with unknown fields; `false` silently ignores them.

  ```ts
  @EsIndex({ name: 'products', dynamic: 'strict' })
  // or per object/nested field:
  @EsField({ type: 'object', properties: () => Address, dynamic: 'strict' })
  ```

- **feat**: Settings diff and auto-sync in `synchronize: 'sync'` mode

  `diff()` now fetches `GET /{index}/_settings` and compares declared vs actual:
  - Dynamic settings (`number_of_replicas`, `refresh_interval`) are auto-applied via `PUT /_settings`
  - Static settings (`number_of_shards`, `analysis`) throw `BreakingSchemaChangeError`

- **docs**: JSDoc added to all public APIs

---

## 0.3.0

### Minor Changes

- **feat**: Point-in-Time (PIT) helpers on `EsIndexService`

  - `openPit(keepAlive)` — open a PIT snapshot and return its ID
  - `closePit(pitId)` — release server resources
  - `scanAll(options)` — async generator that iterates all documents in batches using PIT + `search_after`; PIT is opened/closed automatically

  ```ts
  for await (const batch of service.scanAll({ batchSize: 500 })) {
    await processBatch(batch); // batch: TDocument[]
  }
  ```

- **feat**: Typed query DSL — `EsSearchOptions.query` changed from `Record<string, unknown>` to `estypes.QueryDslQueryContainer`

- **feat**: Extended sort types — `EsSortClause<T>` supports per-field options (`order`, `mode`, `missing`, `nested`) and meta fields (`_score`, `_doc`)

---

## 0.2.0

### Minor Changes

- **feat**: `EsIndexManager.migrate()` — zero-downtime alias-swap reindex

  Creates a new physical index, reindexes from the old one, and atomically swaps the alias.

  ```ts
  const result = await indexManager.migrate(ProductV2, { deleteOldIndex: true });
  // result.fromIndex, result.toIndex, result.documentsReindexed
  ```

  Throws `MigrationError` if `useAlias` is false, the alias is missing, or the target version is already active.

- **feat**: `EsHealthIndicator` — subpath `nestjs-es-kit/health`

  `@nestjs/terminus` integration using the v11 `HealthIndicatorService` API.
  Returns `down` when cluster status is `red` or unreachable.

- **fix**: ES 9.x (Lucene 10) nori compatibility

  - `defaultStopTags = []` — aggregated tags `E` and `J` removed in Lucene 10
  - Synonym normalization: `'A, B'` → `'A,B'` to avoid whitespace tokenizer parse errors; `lenient: true` added
  - Separated index-time `nori_analyzer` and search-time `nori_search_analyzer` (required because `synonym_graph` is search-time only)

---

## 0.1.1

### Patch Changes

- **fix**: CJS consumers received `ts(1479)` error when importing the package

  `exports` had a single top-level `types` field pointing to the ESM declaration file.
  Fixed by splitting into per-condition `import` / `require` entries each with their own `types` field.

---

## 0.1.0

### Minor Changes

- Initial v0.1.0 release.

  Decorator-driven Elasticsearch index lifecycle management for NestJS:

  - `@EsIndex` / `@EsField` decorators — declare ES mapping as a TypeScript class
  - `EsKitModule.forRoot` / `forRootAsync` / `forFeature` — NestJS module integration
  - `synchronize` modes (`none` / `create` / `sync`) — automatic index management at bootstrap
  - `EsIndexService<T>` — typed CRUD, bulk index (chunk + retry + partial failure), search, search_after, aggregate
  - `EsIndexManager` — exists, create, delete, diff, syncMapping with `BreakingSchemaChangeError` on type changes
  - `koreanAnalysis()` — nori tokenizer preset with decompound, stoptags, and synonym options
  - Full ES 8.x / 9.x support via `@elastic/elasticsearch` peerDependency
