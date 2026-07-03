# nestjs-es-kit

> NestJS를 위한 데코레이터 기반 Elasticsearch 인덱스 라이프사이클 관리 모듈

[![npm version](https://badge.fury.io/js/nestjs-es-kit.svg)](https://badge.fury.io/js/nestjs-es-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Elasticsearch 스키마를 데코레이터가 붙은 TypeScript 클래스로 한 번만 선언하면, `nestjs-es-kit`이 애플리케이션 부트스트랩 시 인덱스 생성·매핑 동기화·파괴적 변경 감지를 자동으로 처리합니다.

```ts
@EsIndex({ name: 'products', settings: { analysis: koreanAnalysis() } })
class Product {
  @EsField({ type: 'keyword' }) id: string;
  @EsField({ type: 'text', analyzer: 'nori_analyzer' }) name: string;
  @EsField({ type: 'integer' }) price: number;
}
```

> 영문 문서: [README.md](https://github.com/smw0807/nestjs-es-kit/blob/main/README.md)

---

## 왜 nestjs-es-kit인가?

공식 `@nestjs/elasticsearch`(주간 약 13만 다운로드)는 ES 클라이언트를 DI로 주입해주는 래퍼에 불과합니다. 결국 모든 팀이 프로젝트마다 같은 보일러플레이트를 반복 작성하게 됩니다.

| 매번 반복하는 작업                                | nestjs-es-kit                                                |
| ------------------------------------------------- | ------------------------------------------------------------ |
| 타입과 따로 노는 JSON 매핑 파일 관리              | 데코레이터 스키마 — 단일 소스 오브 트루스                    |
| 인덱스 존재 여부 확인 후 생성하는 부트스트랩 코드 | `synchronize: 'create'`                                      |
| 새 필드 추가 시 수동 `put_mapping`                | `synchronize: 'sync'`                                        |
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

| 옵션               | 타입                  | 기본값 | 설명                                                                                                           |
| ------------------ | --------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `name`             | `string`              | 필수   | 인덱스 기본명. `useAlias: true`이면 물리 인덱스명은 `{name}-v1`                                                |
| `useAlias`         | `boolean`             | `true` | 물리 인덱스 `{name}-v{version}` + alias `{name}` 생성                                                          |
| `version`          | `number`              | `1`    | 현재 스키마 버전 (물리 인덱스명 생성에 사용)                                                                   |
| `settings`         | `EsIndexSettings`     | —      | `numberOfShards`, `numberOfReplicas`, `refreshInterval`, `analysis`                                            |
| `dynamicTemplates` | `EsDynamicTemplate[]` | —      | ES [dynamic templates](https://www.elastic.co/guide/en/elasticsearch/reference/current/dynamic-templates.html) |

#### `@EsField(options)`

| 옵션             | 타입                             | 설명                                                                                                   |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `type`           | `EsFieldType`                    | `keyword` `text` `integer` `long` `float` `double` `boolean` `date` `object` `nested` `ip` `geo_point` |
| `analyzer`       | `string`                         | 색인 시점 분석기                                                                                       |
| `searchAnalyzer` | `string`                         | 검색 시점 분석기 (기본값: `analyzer`와 동일)                                                           |
| `fields`         | `Record<string, EsFieldMapping>` | multi-field (예: `.raw` keyword 서브필드)                                                              |
| `index`          | `boolean`                        | 해당 필드 색인 비활성화                                                                                |
| `docValues`      | `boolean`                        | doc values 비활성화                                                                                    |
| `nullValue`      | `string \| number \| boolean`    | `null` 색인 시 대체값                                                                                  |
| `format`         | `string`                         | date 포맷 문자열                                                                                       |
| `properties`     | `() => Class`                    | 중첩 object/nested 클래스 참조 (순환 참조 방지를 위해 지연 평가)                                       |

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

| 모드       | 동작                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'none'`   | 아무것도 하지 않습니다. 인덱스를 직접 관리합니다.                                                                                                              |
| `'create'` | 인덱스가 없으면 생성합니다. 이미 있으면 아무것도 하지 않습니다. **(기본값)**                                                                                   |
| `'sync'`   | 없으면 생성합니다. 새로 선언된 필드를 `PUT /{index}/_mapping`으로 추가합니다. 파괴적 변경(타입·분석기 변경)이 감지되면 `BreakingSchemaChangeError`를 던집니다. |

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
```

#### 집계 (Aggregation)

```ts
const aggs = await this.products.aggregate(
  {
    byCategory: { terms: { field: 'category', size: 10 } },
    avgPrice: { avg: { field: 'price' } },
  },
  { query: { range: { price: { gte: 10000 } } } }, // 선택: 사전 필터 쿼리
);

const categories = aggs['byCategory'] as {
  buckets: { key: string; doc_count: number }[];
};
const avgPrice = aggs['avgPrice'] as { value: number };
```

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
```

#### `SchemaDiff`

```ts
const diff = await this.indexManager.diff(Product);

diff.addedFields; // string[]      — put_mapping으로 추가 가능
diff.changedFields; // FieldChange[] — 타입/분석기 변경 → ES에서 직접 수정 불가, reindex 필요
diff.removedFields; // string[]      — 정보 제공용 (ES는 필드를 삭제하지 않음)
diff.isBreaking; // boolean
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
      decompound: 'mixed', // 'none' | 'discard' | 'mixed' (기본값)
      stoptags: ['J', 'E', 'SP'], // 제거할 품사 태그 (기본값: 표준 조사·어미 세트)
      synonyms: ['노트북, 랩탑'], // 동의어 목록 (선택)
    }),
  },
})
class Article {
  @EsField({ type: 'text', analyzer: 'nori_analyzer' })
  title: string;
}
```

`koreanAnalysis()`는 `nori_tokenizer` + `nori_part_of_speech` 필터 + `lowercase` 필터로 구성된 `nori_analyzer`를 생성합니다. `@EsField`의 `analyzer` 옵션에서 `'nori_analyzer'`로 참조하세요.

---

### 왜 필드 타입을 변경할 수 없나요?

Elasticsearch는 색인 시점에 타입이 결정된 Apache Lucene 세그먼트에 필드를 저장합니다. `text`를 `keyword`로 바꾸거나 `integer`를 `long`으로 바꾸려면 모든 세그먼트를 재작성해야 하는데, ES는 이를 인플레이스(in-place)로 지원하지 않습니다.

`synchronize: 'sync'` 모드에서 파괴적 변경이 감지되면 잘못된 설정으로 배포가 진행되는 것을 막기 위해 부트스트랩 시점에 `BreakingSchemaChangeError`를 발생시킵니다.

```
BreakingSchemaChangeError: Breaking Elasticsearch schema change detected for products:
  name (text → keyword). Reindex migration is required.
```

**해결 방법**: 새 인덱스(`products-v2`)를 생성하고, 데이터를 reindex한 뒤 alias를 교체합니다. 이 과정은 **v0.2**에서 `EsKitModule.migrate()`로 자동화될 예정입니다.

v0.2 이전까지는 `EsIndexManager`로 직접 처리할 수 있습니다.

```ts
// 마이그레이션 스크립트 (v0.2 전까지의 임시 방법)
await manager.create(ProductV2);
await client.reindex({
  source: { index: 'products-v1' },
  dest: { index: 'products-v2' },
});
await client.indices.updateAliases({
  actions: [
    { remove: { index: 'products-v1', alias: 'products' } },
    { add: { index: 'products-v2', alias: 'products' } },
  ],
});
```

---

### 에러 클래스

```ts
import {
  EsKitError, // 베이스 클래스 — 모든 에러가 상속
  IndexNotFoundError, // 인덱스 없음 (synchronize: 'none' 상태)
  IndexAlreadyExistsError,
  BreakingSchemaChangeError, // diff.isBreaking — 메시지에 변경 필드 목록 포함
  BulkPartialFailureError, // opt-in: bulkIndex({ throwOnFailure: true })
  SchemaMetadataError, // 데코레이터 선언 오류 (예: @EsField가 0개)
  UnsupportedEsVersionError, // ES 8 미만 버전에 연결된 경우
} from 'nestjs-es-kit';
```

모든 에러는 원본 ES 에러를 `cause`로 보존합니다.

---

## 로드맵

| 버전     | 범위                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------- |
| **v0.1** | 데코레이터 스키마, forRoot/forFeature, synchronize, CRUD, bulk, search, aggregate, nori 프리셋, 에러 체계 |
| **v0.2** | `migrate()` — alias 스왑 기반 무중단 reindex, `npx es-kit migrate` CLI                                    |
| **v0.3** | search 타입 강화, scroll/PIT 헬퍼                                                                         |
| **v0.4** | 집계 종류별 응답 타입 추론, nori 사용자 사전 지원                                                         |

---

## 라이선스

MIT © [songminwoo](https://github.com/smw0807)
