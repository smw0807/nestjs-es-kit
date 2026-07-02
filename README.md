# nestjs-es-kit

Decorator-driven Elasticsearch index lifecycle management for NestJS.

## Status

This repository is in the initial project setup stage. The current scaffold includes:

- TypeScript strict library setup
- `tsup` ESM/CJS build output
- Vitest unit test setup
- Changesets and GitHub Actions CI
- Decorator metadata collection with `@EsIndex` and `@EsField`
- Schema builder for Elasticsearch settings/mappings
- NestJS `EsKitModule.forRoot`, `forRootAsync`, and `forFeature`
- `EsIndexManager` for create, diff, and syncMapping
- `EsIndexService` for CRUD, bulk index, search, search template, search after, aggregate, and raw client access
- Korean nori analysis preset

## Quick Start

```ts
import { EsField, EsIndex, EsKitModule, InjectIndex, koreanAnalysis, EsIndexService } from 'nestjs-es-kit';

@EsIndex({
  name: 'products',
  settings: {
    analysis: koreanAnalysis(),
  },
})
class Product {
  @EsField({ type: 'keyword' })
  id!: string;

  @EsField({ type: 'text', analyzer: 'nori_analyzer' })
  name!: string;
}

@Module({
  imports: [
    EsKitModule.forRoot({
      node: 'http://localhost:9200',
      synchronize: 'create',
    }),
    EsKitModule.forFeature([Product]),
  ],
})
class AppModule {}

class ProductService {
  constructor(@InjectIndex(Product) private readonly products: EsIndexService<Product>) {}
}
```

## Korean Analysis

`koreanAnalysis()` uses Elasticsearch's `analysis-nori` plugin. Install it on each Elasticsearch node before using the preset:

```sh
bin/elasticsearch-plugin install analysis-nori
```
