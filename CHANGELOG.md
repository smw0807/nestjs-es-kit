# nestjs-es-kit

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
