# nestjs-es-kit

> NestJS를 위한 데코레이터 기반 Elasticsearch 인덱스 라이프사이클 관리 모듈

[![npm version](https://badge.fury.io/js/nestjs-es-kit.svg)](https://badge.fury.io/js/nestjs-es-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> 영문 문서: [README.md](https://github.com/smw0807/nestjs-es-kit/blob/main/README.md)

Elasticsearch 스키마를 데코레이터가 붙은 TypeScript 클래스로 한 번만 선언하면, `nestjs-es-kit`이 애플리케이션 부트스트랩 시 인덱스 생성·매핑 동기화·파괴적 변경 감지를 자동으로 처리합니다.

```ts
@EsIndex({ name: 'products', settings: { analysis: koreanAnalysis() } })
class Product {
  @EsField({ type: 'keyword' }) id: string;
  @EsField({ type: 'text', analyzer: 'nori_analyzer' }) name: string;
  @EsField({ type: 'integer' }) price: number;
}
```

## 1.0.2 변경 사항

- 무중단 마이그레이션 안정성 강화: `reindex`가 실패·timeout·version conflict 없이 완료된 경우에만 alias를 교체합니다.
- `scanAll()`이 Elasticsearch가 매 페이지 반환하는 최신 PIT ID를 따라가고, 종료 시 최신 PIT를 닫습니다.
- object/nested 매핑 diff를 재귀 처리합니다. `seller.rating` 같은 안전한 중첩 필드 추가는 reindex 없이 동기화됩니다.
- `@InjectIndex()` 프로바이더 토큰을 스키마 클래스 identity 기반으로 바꿔, 같은 이름의 클래스가 서로 충돌하지 않게 했습니다.
- CLI config 검증을 강화해 `schemas` 누락, 잘못된 schema 값, 잘못된 `migrateOptions`를 명확한 에러로 알려줍니다.

---

## 왜 nestjs-es-kit인가?

공식 `@nestjs/elasticsearch`(주간 약 13만 다운로드)는 ES 클라이언트를 DI로 주입해주는 래퍼에 불과합니다. 결국 모든 팀이 프로젝트마다 같은 보일러플레이트를 반복 작성하게 됩니다.

| 매번 반복하는 작업                                | nestjs-es-kit                                                |
| ------------------------------------------------- | ------------------------------------------------------------ |
| 타입과 따로 노는 JSON 매핑 파일 관리              | 데코레이터 스키마 — 단일 소스 오브 트루스                    |
| 인덱스 존재 여부 확인 후 생성하는 부트스트랩 코드 | `synchronize: 'create'`                                      |
| 새 필드 및 중첩 필드 추가 시 수동 `put_mapping`    | 재귀 매핑 diff가 포함된 `synchronize: 'sync'`                 |
| 어떤 매핑 변경이 reindex를 필요로 하는지 파악     | `diff()` + `BreakingSchemaChangeError` (변경 필드 목록 포함) |
| bulk 청크 분할, 재시도, 부분 실패 파싱            | `bulkIndex()`                                                |

**경쟁 현황 (npm, 2026-07)**

| 패키지                              | 주간 DL  | 상태        | 영역                                         |
| ----------------------------------- | -------- | ----------- | -------------------------------------------- |
| @nestjs/elasticsearch               | ~131,000 | 활성        | DI 래퍼만 제공                               |
| @codemask-labs/nestjs-elasticsearch | ~70      | 활성        | 쿼리 타입 안정성                             |
| es-mapping-ts                       | ~3,000   | 2020년 방치 | 데코레이터 매핑 (ES 6/7)                     |
| elasticsearch-index-migrate         | ~1,000   | 2022년 방치 | 마이그레이션 CLI                             |
| **nestjs-es-kit**                   | —        | **활성**    | **인덱스 라이프사이클 + 한국어 nori 프리셋** |

---

## 설치

```bash
npm install nestjs-es-kit
# peer dependencies
npm install @elastic/elasticsearch @nestjs/common @nestjs/core reflect-metadata
```

`tsconfig.json`에 데코레이터 메타데이터를 활성화합니다.

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

---

## 빠른 시작

### 1. 스키마 선언

```ts
// product.schema.ts
import { EsIndex, EsField, koreanAnalysis } from 'nestjs-es-kit';

@EsIndex({
  name: 'products',
  useAlias: true, // products-v1 인덱스 + 'products' alias 생성 (기본값: true)
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

### 2. 모듈 등록

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

### 3. 서비스에서 사용

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

## API 레퍼런스

### 데코레이터

#### `@EsIndex(options)`

| 옵션               | 타입                                           | 기본값              | 설명                                                                                                           |
| ------------------ | ---------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `name`             | `string`                                       | 필수                | 인덱스 기본명. `useAlias: true`이면 물리 인덱스명은 `{name}-v1`                                                |
| `useAlias`         | `boolean`                                      | `true`              | 물리 인덱스 `{name}-v{version}` + alias `{name}` 생성                                                          |
| `version`          | `number`                                       | `1`                 | 현재 스키마 버전 (물리 인덱스명 생성에 사용)                                                                   |
| `settings`         | `EsIndexSettings`                              | —                   | `numberOfShards`, `numberOfReplicas`, `refreshInterval`, `analysis`                                            |
| `dynamicTemplates` | `EsDynamicTemplate[]`                          | —                   | ES [dynamic templates](https://www.elastic.co/guide/en/elasticsearch/reference/current/dynamic-templates.html) |
| `dynamic`          | `true \| false \| 'strict' \| 'runtime'`       | `true` (ES 기본값) | 문서에 선언되지 않은 필드가 나타났을 때의 처리 방식 ([Dynamic Mapping](#dynamic-mapping) 참고)                  |

#### `@EsField(options)`

| 옵션             | 타입                                     | 설명                                                                                                   |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `type`           | `EsFieldType`                            | `keyword` `text` `integer` `long` `float` `double` `boolean` `date` `object` `nested` `ip` `geo_point` |
| `analyzer`       | `string`                                 | 색인 시점 분석기                                                                                       |
| `searchAnalyzer` | `string`                                 | 검색 시점 분석기 (기본값: `analyzer`와 동일)                                                           |
| `fields`         | `Record<string, EsFieldMapping>`         | multi-field (예: `.raw` keyword 서브필드)                                                              |
| `index`          | `boolean`                                | 해당 필드 색인 비활성화                                                                                |
| `docValues`      | `boolean`                                | doc values 비활성화                                                                                    |
| `nullValue`      | `string \| number \| boolean`            | `null` 색인 시 대체값                                                                                  |
| `format`         | `string`                                 | date 포맷 문자열                                                                                       |
| `properties`     | `() => Class`                            | 중첩 object/nested 클래스 참조 (순환 참조 방지를 위해 지연 평가)                                       |
| `dynamic`        | `true \| false \| 'strict' \| 'runtime'` | `object`/`nested` 타입에 대한 필드 단위 dynamic mapping                                               |

#### `@InjectIndex(SchemaClass)`

생성자에서 `EsIndexService<T>`를 주입받기 위한 DI 토큰입니다.

---

### 모듈

#### `EsKitModule.forRoot(options)`

```ts
EsKitModule.forRoot({
  node: 'http://localhost:9200',
  auth: { username: 'elastic', password: '...' },
  synchronize: 'create', // 기본값
  logger: true,
});
```

모든 옵션은 `@elastic/elasticsearch`의 `ClientOptions`를 확장합니다 — ES 클라이언트로 그대로 전달됩니다.

**nestjs-es-kit 전용 옵션:**

| 옵션          | 타입                | 기본값      | 설명                                                                            |
| ------------- | ------------------- | ----------- | ------------------------------------------------------------------------------- |
| `synchronize` | `EsSynchronizeMode` | `'create'`  | 부트스트랩 시 인덱스 동기화 전략 ([synchronize 모드](#synchronize-모드) 참고)   |
| `logger`      | `boolean`           | `false`     | 인덱스 생성/마이그레이션/설정 변경 이벤트를 NestJS `Logger`로 출력              |

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

각 스키마에 대한 `EsIndexService<T>` 프로바이더를 등록하고, 모듈 초기화 시 동기화를 실행합니다.

---

### `synchronize` 모드

`forFeature`로 등록된 모든 스키마에 대해 애플리케이션 부트스트랩 시 자동으로 동기화가 실행됩니다.

| 모드       | 동작                                                                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'none'`   | 아무것도 하지 않습니다. 인덱스를 직접 관리합니다.                                                                                                                                         |
| `'create'` | 인덱스가 없으면 생성합니다. 이미 있으면 아무것도 하지 않습니다. **(기본값)**                                                                                                              |
| `'sync'`   | 없으면 생성합니다. 매핑과 설정 변경을 감지합니다: top-level 및 object/nested 새 필드는 `PUT /_mapping`으로 추가, 동적 설정은 `PUT /_settings`로 자동 적용, 파괴적 변경은 `BreakingSchemaChangeError`를 던집니다. |

**`'sync'`의 설정 변경 분류:**

| 설정                                        | 분류 | 처리                                            |
| ------------------------------------------- | ---- | ----------------------------------------------- |
| `number_of_replicas`, `refresh_interval` 등 | 동적 | `PUT /{index}/_settings`로 자동 적용             |
| `number_of_shards`, `analysis`              | 정적 | `BreakingSchemaChangeError` 발생 — reindex 필요  |

**환경별 권장 모드**

- **개발 환경**: `'sync'` — 새 필드를 자동으로 반영합니다.
- **운영 환경 (스키마 안정)**: `'create'` — 예기치 않은 변경 없이 안전합니다.
- **운영 환경 (마이그레이션 제어)**: `'none'` + 배포 스크립트에서 `EsIndexManager` 직접 호출.

---

### `EsIndexService<T>`

`@InjectIndex(SchemaClass)`로 주입받아 사용합니다.

#### 문서 작업

```ts
// 색인 (생성 또는 교체)
const id = await this.products.index(doc, { id: doc.id, refresh: 'wait_for' });

// ID로 조회
const doc = await this.products.get('product-1'); // 없으면 null 반환

// 부분 업데이트
await this.products.update(
  'product-1',
  { price: 9900 },
  { refresh: 'wait_for' },
);

// 삭제
await this.products.delete('product-1');
```

#### Bulk 색인

```ts
const result = await this.products.bulkIndex(docs, {
  chunkSize: 1000, // 기본값 1000
  retries: 3, // 429/503 에러 지수 백오프 재시도
  refresh: false,
  idSelector: (doc) => doc.id,
  throwOnFailure: false, // true로 설정하면 실패 시 BulkPartialFailureError 발생
});

result.total; // 전체 문서 수
result.succeeded; // 성공 건수
result.failed; // BulkFailedItem[] — { doc, error, status }
```

#### 검색

```ts
// 기본 검색 — _source가 T[] 타입으로 반환
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

// search_after (커서 페이지네이션)
const page = await this.products.searchAfter({
  query: { match_all: {} },
  sort: [{ createdAt: 'desc' }, { id: 'asc' }],
  size: 20,
  after: prevPage.nextCursor, // 첫 페이지는 생략
});
page.nextCursor; // 다음 페이지 요청 시 전달

// scan all — Point-in-Time 기반 비동기 제너레이터 (대용량 데이터 순회)
for await (const batch of this.products.scanAll({
  query: { term: { category: 'electronics' } },
  sort: [{ createdAt: 'asc' }],
  batchSize: 1000,
  keepAlive: '1m',
})) {
  await processInBatch(batch); // batch: Product[]
}
```

#### 집계 (Aggregation)

집계 정의에서 응답 타입이 자동으로 추론됩니다.

```ts
const aggs = await this.products.aggregate(
  {
    byCategory: { terms: { field: 'category', size: 10 } },
    avgPrice:   { avg:   { field: 'price' } },
    totalCount: { value_count: { field: 'id' } },
  },
  { query: { range: { price: { gte: 10000 } } } }, // 선택: 사전 필터 쿼리
);

// TypeScript가 타입을 자동 추론:
aggs.byCategory.buckets;  // TermsBucket[]  — { key, doc_count }[]
aggs.avgPrice.value;      // number | null
aggs.totalCount.value;    // number
```

지원하는 집계 → 결과 타입 매핑:

| 집계                                                    | 결과 타입                                     |
| ------------------------------------------------------- | --------------------------------------------- |
| `terms`, `significant_terms`                            | `{ buckets: TermsBucket[] }`                  |
| `avg`, `min`, `max`, `sum`, `median_absolute_deviation` | `{ value: number \| null }`                   |
| `value_count`, `cardinality`                            | `{ value: number }`                           |
| `date_histogram`                                        | `{ buckets: DateHistogramBucket[] }`          |
| `range`, `date_range`, `ip_range`                       | `{ buckets: RangeBucket[] }`                  |
| `top_hits`                                              | `{ hits: { total: ...; hits: SearchHit[] } }` |
| 기타                                                    | `unknown`                                     |

#### Point-in-Time (PIT) 헬퍼

```ts
// PIT 수동 제어 (고급 사용 사례)
const pitId = await this.products.openPit('5m');
// ... 같은 PIT를 재사용해 여러 search_after 호출 ...
await this.products.closePit(pitId);

// scanAll — 비동기 제너레이터, PIT를 자동으로 열고 닫음
for await (const batch of this.products.scanAll({ batchSize: 500 })) {
  await processInBatch(batch); // batch: Product[]
}
```

`scanAll()`은 Elasticsearch가 매 페이지 반환하는 갱신된 `pit_id`를 추적하고, 반복이 끝나면 최신 PIT ID를 닫습니다.

`scanAll` 옵션:

| 옵션        | 타입                     | 기본값           |
| ----------- | ------------------------ | ---------------- |
| `query`     | `QueryDslQueryContainer` | `match_all`      |
| `sort`      | `EsSortClause[]`         | `[{_doc:'asc'}]` |
| `batchSize` | `number`                 | `1000`           |
| `keepAlive` | `string`                 | `'1m'`           |

#### Raw 탈출구

```ts
this.products.raw; // @elastic/elasticsearch Client — ES 전체 API 직접 접근
this.products.indexName; // useAlias: true이면 alias명, 아니면 물리 인덱스명
```

---

### `EsIndexManager`

`@InjectIndex` 없이 그대로 주입합니다.

```ts
constructor(private readonly indexManager: EsIndexManager) {}

await this.indexManager.exists(Product);
await this.indexManager.create(Product);
await this.indexManager.delete(Product, { force: true });  // force 필수
await this.indexManager.syncMapping(Product);
await this.indexManager.diff(Product);
await this.indexManager.migrate(ProductV2);              // 무중단 reindex
await this.indexManager.migrate(ProductV2, { deleteOldIndex: true }); // + 이전 인덱스 삭제
```

#### `migrate()`

현재 물리 인덱스에서 다음 버전으로 무중단 alias 스왑 reindex를 수행합니다.

```ts
// 1. @EsIndex version 업데이트
@EsIndex({ name: 'products', version: 2 })
class ProductV2 { ... }

// 2. 배포 스크립트 또는 NestJS 부트스트랩 훅에서
const result = await indexManager.migrate(ProductV2, { deleteOldIndex: false });
// result.fromIndex          → 'products-v1'
// result.toIndex            → 'products-v2'
// result.documentsReindexed → number
```

요구 사항:
- `@EsIndex`에 `useAlias: true` 설정 필수
- alias가 이미 존재해야 함 (`synchronize: 'create'` 또는 `'sync'`로 생성)
- `@EsIndex`의 version이 현재 활성 인덱스보다 높아야 함

alias가 없거나 `useAlias`가 false이거나 대상 버전이 이미 활성화된 경우 `MigrationError`를 던집니다.

`migrate()`는 alias를 교체하기 전에 `reindex` 응답을 검증합니다. Elasticsearch가 실패, timeout, version conflict를 보고하면 새 인덱스를 삭제하고 alias는 이전 인덱스를 계속 가리키도록 유지합니다.

#### `SchemaDiff`

```ts
const diff = await this.indexManager.diff(Product);

diff.addedFields;     // string[]        — put_mapping으로 추가 가능; 중첩 필드 추가는 'seller.rating' 같은 dotted path
diff.changedFields;   // FieldChange[]   — 타입/분석기 변경 → ES에서 직접 수정 불가, reindex 필요
diff.removedFields;   // string[]        — 정보 제공용 (ES는 필드를 삭제하지 않음)
diff.settingsChanges; // SettingChange[] — 변경된 설정 ({ setting, before, after })
diff.isBreaking;      // boolean — changedFields 또는 정적 설정(number_of_shards, analysis) 변경 시 true
```

---

### 한국어 분석 — `koreanAnalysis()`

[`analysis-nori`](https://www.elastic.co/guide/en/elasticsearch/plugins/current/analysis-nori.html) 플러그인이 필요합니다.

```sh
# 일반 설치
bin/elasticsearch-plugin install analysis-nori

# Docker 사용 시 — 커스텀 Dockerfile 작성
# FROM docker.elastic.co/elasticsearch/elasticsearch:8.18.2
# RUN elasticsearch-plugin install --batch analysis-nori
```

```ts
import { koreanAnalysis } from 'nestjs-es-kit';

@EsIndex({
  name: 'articles',
  settings: {
    analysis: koreanAnalysis({
      decompound: 'mixed',       // 'none' | 'discard' | 'mixed' (기본값)
      stoptags: ['IC', 'SP'],    // 품사 태그 — ES 9.x: 세종 태그; ES 8.x: 'J','E'
      synonyms: ['노트북,랩탑'], // 동의어 목록 — nori_search_analyzer 자동 생성
      userDictionaryRules: [     // 인라인 사용자 사전 규칙
        '삼성전자',
        'LG전자',
        '카카오 카카오',         // '단어 분해1 분해2' 형식으로 분해 지정
      ],
    }),
  },
})
class Article {
  @EsField({ type: 'text', analyzer: 'nori_analyzer', searchAnalyzer: 'nori_search_analyzer' })
  title: string;
}
```

`koreanAnalysis()`가 생성하는 분석기:
- `nori_analyzer` — 색인용: `nori_tokenizer` + 품사 필터 + `lowercase`
- `nori_search_analyzer` — 검색용: 품사 필터 앞에 `synonym_graph` 필터 추가 (`synonyms` 설정 시에만)

> **참고**: 기본 `stoptags`는 ES 8/9 호환성을 위해 비어 있습니다. ES 9.x(Lucene 10)는 ES 8.x의 집합 태그(`J`, `E`) 대신 세종 태그셋(`JKS`, `EF` 등)을 사용합니다.

---

### CLI — `npx es-kit`

NestJS 앱을 전부 시작하지 않고 커맨드라인에서 인덱스 작업을 실행합니다. CI/CD 파이프라인이나 배포 스크립트에 유용합니다.

#### 1. 설정 파일 작성

```js
// es-kit.config.js  (ESM, 저장소에 커밋)
import { ProductV2 } from './dist/product.schema.js';
import { Order } from './dist/order.schema.js';

export default {
  node: process.env.ES_NODE ?? 'http://localhost:9200',
  auth: {
    username: process.env.ES_USERNAME ?? 'elastic',
    password: process.env.ES_PASSWORD ?? '',
  },
  schemas: [ProductV2, Order],
  migrateOptions: { deleteOldIndex: false }, // migrate 커맨드의 기본 옵션
};
```

> 설정 파일은 **컴파일된** 출력(`dist/`)에서 불러옵니다. TypeScript 빌드를 먼저 실행하세요.
> CLI는 Elasticsearch에 연결하기 전에 `schemas`가 비어 있지 않은 schema class 배열인지 검증합니다.

#### 2. 커맨드 실행

```bash
# 모든 스키마의 매핑/설정 차이 출력
npx es-kit diff --config ./es-kit.config.js

# 매핑/설정 변경 적용 (파괴적 변경 시 종료 코드 1)
npx es-kit sync --config ./es-kit.config.js

# 아직 없는 인덱스만 생성
npx es-kit create --config ./es-kit.config.js

# 무중단 alias 스왑 reindex (useAlias: true 필요)
npx es-kit migrate --config ./es-kit.config.js
npx es-kit migrate --config ./es-kit.config.js --delete-old  # 이전 인덱스도 삭제
```

`diff`는 파괴적 변경이 감지되면 종료 코드 1로 종료됩니다. `sync`는 파괴적 변경이 적용될 경우 종료 코드 1로 종료됩니다.

---

### Standalone Manager

NestJS 애플리케이션 컨텍스트 밖에서 프로그래밍 방식으로 제어가 필요할 때 `EsStandaloneManager`를 사용합니다.

```ts
import { EsStandaloneManager } from 'nestjs-es-kit/standalone';
import { ProductV2 } from './product.schema.js';

const manager = new EsStandaloneManager({
  node: 'http://localhost:9200',
  auth: { username: 'elastic', password: 'secret' },
});

// 차이 확인
const diff = await manager.diff(ProductV2);
console.log(diff.settingsChanges, diff.isBreaking);

// 무중단 마이그레이션
const result = await manager.migrate(ProductV2, { deleteOldIndex: true });
// result.fromIndex, result.toIndex, result.documentsReindexed

// Sync (동적 설정 자동 적용, 파괴적 변경 시 예외 발생)
await manager.sync(ProductV2);
```

`EsStandaloneManager`가 제공하는 메서드: `exists`, `create`, `diff`, `sync`, `migrate`.

---

### Dynamic Mapping

`dynamic` 옵션은 매핑에 **선언되지 않은** 필드가 문서에 나타났을 때 Elasticsearch가 처리하는 방식을 제어합니다.

| 값          | 동작                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `true`      | 새 필드를 자동으로 매핑 (ES 기본값)                                                                                                                               |
| `false`     | 새 필드를 무시 — `_source`에는 저장되지만 검색 불가                                                                                                              |
| `'strict'`  | 선언되지 않은 필드를 포함한 문서를 **거부** (예외 발생)                                                                                                           |
| `'runtime'` | 새 필드를 [runtime fields](https://www.elastic.co/guide/en/elasticsearch/reference/current/runtime.html)로 추가 |

#### 인덱스 레벨 strict 모드

```ts
@EsIndex({
  name: 'products',
  dynamic: 'strict', // 선언되지 않은 필드를 포함한 문서 거부
})
export class Product {
  @EsField({ type: 'keyword' }) id: string;
  @EsField({ type: 'text' }) name: string;
}
```

`{ id: '1', name: 'Laptop', unknownField: 'value' }`를 색인하면 `strict_dynamic_mapping_exception`이 발생합니다.

#### 필드 단위 strict 모드 (object / nested)

최상위 인덱스는 열어두고 중첩 객체에만 선택적으로 `dynamic`을 적용할 수 있습니다.

```ts
@EsIndex({ name: 'orders' })
export class Order {
  @EsField({ type: 'keyword' }) id: string;

  @EsField({
    type: 'object',
    properties: () => Address,
    dynamic: 'strict', // 중첩된 Address 객체만 미선언 필드를 거부
  })
  address?: Address;
}
```

---

### 왜 필드 타입을 변경할 수 없나요?

Elasticsearch는 색인 시점에 타입이 결정된 Apache Lucene 세그먼트에 필드를 저장합니다. `text`를 `keyword`로 바꾸거나 `integer`를 `long`으로 바꾸려면 모든 세그먼트를 재작성해야 하는데, ES는 이를 인플레이스(in-place)로 지원하지 않습니다.

`synchronize: 'sync'` 모드에서 파괴적 변경이 감지되면 잘못된 설정으로 배포가 진행되는 것을 막기 위해 부트스트랩 시점에 `BreakingSchemaChangeError`를 발생시킵니다.

```
BreakingSchemaChangeError: Breaking Elasticsearch schema change detected for products:
  name (text → keyword). Reindex migration is required.
```

**해결 방법**: `@EsIndex`의 버전을 올리고 `EsIndexManager.migrate()`를 사용합니다.

```ts
// @EsIndex({ version: 2 })로 버전 증가 후:
const result = await indexManager.migrate(ProductV2, { deleteOldIndex: true });
// products-v1 → products-v2, alias 'products' 원자적 교체
```

자세한 내용은 위의 [`migrate()` 문서](#migrate)를 참고하세요.

---

### 에러 클래스

```ts
import {
  EsKitError,             // 베이스 클래스 — 모든 에러가 상속
  IndexNotFoundError,     // 인덱스 없음 (synchronize: 'none' 상태)
  IndexAlreadyExistsError,
  BreakingSchemaChangeError, // diff.isBreaking — 메시지에 변경 필드 목록 포함
  BulkPartialFailureError,   // opt-in: bulkIndex({ throwOnFailure: true })
  SchemaMetadataError,    // 데코레이터 선언 오류 (예: @EsField가 0개)
  UnsupportedEsVersionError, // ES 8 미만 버전에 연결된 경우
  MigrationError,         // migrate() — alias 없음, useAlias: false, 버전 충돌
} from 'nestjs-es-kit';
```

모든 에러는 원본 ES 에러를 `cause`로 보존합니다.

---

### Health Check — `EsHealthIndicator`

[`@nestjs/terminus`](https://docs.nestjs.com/recipes/terminus)가 필요합니다.

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

정상 응답:

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

`EsHealthIndicator`는 `GET /_cluster/health`를 사용하며, 클러스터 상태가 `red`이거나 연결 불가 시 `down`으로 표시합니다.

---

## 로드맵

| 버전         | 범위                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0.1**     | 데코레이터 스키마, forRoot/forFeature, synchronize, CRUD, bulk, search, aggregate, nori 프리셋, 에러 체계                                              |
| **v0.2**     | `migrate()` alias 스왑 기반 무중단 reindex, `EsHealthIndicator` terminus 연동, ES 9.x nori 호환성                                                     |
| **v0.3**     | `scanAll()` PIT 기반 비동기 제너레이터, `openPit`/`closePit`, 타입 쿼리 DSL, 확장 정렬 타입, `dynamic` 매핑 옵션, `synchronize: 'sync'` 설정 diff/sync |
| **v0.4**     | `npx es-kit` CLI (`migrate`/`sync`/`diff`/`create`), `EsStandaloneManager`, 집계별 응답 타입 추론, nori `userDictionaryRules`                         |
| **v1.0.0** ✓ | 정식 안정 릴리스 — 공개 API 확정, 이후 변경은 semver major 규칙 적용                                                                                  |
| **v1.0.2** ✓ | 마이그레이션 안전 검증, 최신 PIT ID 추적, object/nested 재귀 매핑 sync, 스키마 identity 기반 DI 토큰, CLI config 검증                                  |

---

## 라이선스

MIT © [songminwoo](https://github.com/smw0807)
