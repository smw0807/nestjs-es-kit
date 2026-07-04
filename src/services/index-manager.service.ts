import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import type { estypes } from '@elastic/elasticsearch';

import { ES_KIT_CLIENT, ES_KIT_OPTIONS } from '../constants.js';
import { BreakingSchemaChangeError, MigrationError } from '../errors/index.js';
import { SchemaBuilder } from '../metadata/schema-builder.js';
import { diffMappings } from '../migration/schema-diff.js';
import type { EsClient, EsDocumentClass, EsKitModuleOptions, MigrateOptions, MigrateResult, SchemaDiff } from '../types.js';

/**
 * Elasticsearch 인덱스 생명주기를 관리하는 서비스.
 * 모듈 초기화 시 `synchronize` 옵션에 따라 인덱스를 자동 생성 또는 매핑을 동기화합니다.
 * `EsKitModule.forRoot()`로 전역 등록되며, 직접 주입하여 사용할 수도 있습니다.
 */
@Injectable()
export class EsIndexManager implements OnModuleInit {
  private readonly logger = new Logger(EsIndexManager.name);
  private readonly schemaBuilder = new SchemaBuilder();
  private schemas: EsDocumentClass[] = [];

  constructor(
    @Inject(ES_KIT_CLIENT) private readonly client: EsClient,
    @Inject(ES_KIT_OPTIONS) private readonly options: EsKitModuleOptions,
    @Optional() @Inject('ES_KIT_SCHEMAS') schemas?: EsDocumentClass[],
  ) {
    this.schemas = schemas ?? [];
  }

  /** NestJS 모듈 초기화 시 등록된 스키마를 자동 동기화합니다. */
  async onModuleInit(): Promise<void> {
    await this.synchronizeSchemas(this.schemas);
  }

  /**
   * 전달된 스키마 목록을 `synchronize` 옵션에 따라 처리합니다.
   * - `'create'`: 인덱스가 없으면 생성, 있으면 건너뜀
   * - `'sync'`: 인덱스가 없으면 생성, 있으면 매핑 차이를 반영
   * - `'none'`: 아무 작업도 하지 않음
   */
  async synchronizeSchemas(schemas: EsDocumentClass[]): Promise<void> {
    if (this.options.synchronize === 'none') {
      return;
    }

    for (const schema of schemas) {
      if (this.options.synchronize === 'sync') {
        await this.syncMapping(schema);
      } else {
        await this.create(schema);
      }
    }
  }

  /**
   * 스키마에 해당하는 물리 인덱스가 ES에 존재하는지 확인합니다.
   *
   * @param target - `@EsIndex`가 선언된 스키마 클래스
   */
  async exists<TDocument extends object>(target: EsDocumentClass<TDocument>): Promise<boolean> {
    const schema = this.schemaBuilder.build(target);
    return this.client.indices.exists({ index: schema.index });
  }

  /**
   * 스키마를 기반으로 ES 인덱스를 생성합니다.
   * `useAlias: true`이면 별칭도 함께 설정합니다.
   * 인덱스가 이미 존재하면 아무 작업도 하지 않습니다.
   *
   * @param target - `@EsIndex`가 선언된 스키마 클래스
   */
  async create<TDocument extends object>(target: EsDocumentClass<TDocument>): Promise<void> {
    const schema = this.schemaBuilder.build(target);

    if (await this.exists(target)) {
      return;
    }

    const request: estypes.IndicesCreateRequest = {
      index: schema.index,
      mappings: schema.mappings as unknown as estypes.MappingTypeMapping,
    };

    if (schema.settings !== undefined) {
      request.settings = schema.settings;
    }

    if (schema.useAlias) {
      request.aliases = { [schema.alias]: {} };
    }

    await this.client.indices.create(request);

    if (this.options.logger === true) {
      this.logger.log(`Created Elasticsearch index ${schema.index}.`);
    }
  }

  /**
   * 물리 인덱스를 삭제합니다.
   * 실수로 인한 데이터 손실 방지를 위해 반드시 `{ force: true }`를 전달해야 합니다.
   *
   * @param target - `@EsIndex`가 선언된 스키마 클래스
   * @param options.force - 반드시 `true`이어야 삭제가 실행됩니다.
   */
  async delete<TDocument extends object>(target: EsDocumentClass<TDocument>, options: { force?: boolean } = {}): Promise<void> {
    if (options.force !== true) {
      throw new Error('Deleting an index requires { force: true }.');
    }

    const schema = this.schemaBuilder.build(target);
    await this.client.indices.delete({ index: schema.index });
  }

  /**
   * 코드로 선언된 매핑과 ES 실제 매핑의 차이를 계산합니다.
   * 인덱스가 없으면 모든 필드를 `addedFields`로 반환합니다.
   *
   * @param target - `@EsIndex`가 선언된 스키마 클래스
   * @returns `addedFields`, `changedFields`, `removedFields`, `isBreaking` 포함한 차이 정보
   */
  async diff<TDocument extends object>(target: EsDocumentClass<TDocument>): Promise<SchemaDiff> {
    const schema = this.schemaBuilder.build(target);

    if (!(await this.exists(target))) {
      return {
        addedFields: Object.keys(schema.mappings.properties),
        changedFields: [],
        removedFields: [],
        settingsChanges: [],
        isBreaking: false,
      };
    }

    const mappingResponse = await this.client.indices.getMapping({ index: schema.index });
    const indexMapping = mappingResponse[schema.index]?.mappings.properties ?? {};

    return diffMappings(schema.mappings.properties, indexMapping as Record<string, never>);
  }

  /**
   * 별칭 스왑 방식의 무중단 인덱스 마이그레이션을 수행합니다.
   *
   * 과정:
   * 1. 현재 별칭이 가리키는 구 인덱스 조회
   * 2. 새 버전의 물리 인덱스 생성
   * 3. 구 인덱스 → 신 인덱스 `reindex` (wait_for_completion)
   * 4. 별칭을 원자적으로 교체 (remove + add)
   * 5. `deleteOldIndex: true`이면 구 인덱스 삭제
   *
   * @param target - `@EsIndex({ useAlias: true })`가 선언된 스키마 클래스
   * @param options.deleteOldIndex - 마이그레이션 후 구 인덱스 삭제 여부 (기본 `false`)
   * @returns 이전·신규 인덱스명 및 재인덱싱된 문서 수
   * @throws `MigrationError` — `useAlias: false`이거나 별칭을 찾을 수 없을 때
   */
  async migrate<TDocument extends object>(
    target: EsDocumentClass<TDocument>,
    options: MigrateOptions = {},
  ): Promise<MigrateResult> {
    const schema = this.schemaBuilder.build(target);

    if (!schema.useAlias) {
      throw new MigrationError(
        `Cannot migrate ${schema.index}: migration requires useAlias: true on @EsIndex.`,
      );
    }

    let oldIndex: string;
    try {
      const aliasResponse = await this.client.indices.getAlias({ name: schema.alias });
      const indices = Object.keys(aliasResponse);
      const first = indices[0];
      if (first === undefined) {
        throw new MigrationError(`Alias ${schema.alias} points to no index.`);
      }
      oldIndex = first;
    } catch (error) {
      if (error instanceof MigrationError) throw error;
      throw new MigrationError(
        `Alias ${schema.alias} not found. Create the index first (synchronize: 'create' or 'sync').`,
        { cause: error },
      );
    }

    if (oldIndex === schema.index) {
      throw new MigrationError(
        `${schema.index} is already the active index for alias ${schema.alias}. Increment version in @EsIndex to proceed.`,
      );
    }

    const request: estypes.IndicesCreateRequest = {
      index: schema.index,
      mappings: schema.mappings as unknown as estypes.MappingTypeMapping,
    };
    if (schema.settings !== undefined) {
      request.settings = schema.settings;
    }
    await this.client.indices.create(request);

    const reindexResponse = await this.client.reindex({
      source: { index: oldIndex },
      dest: { index: schema.index },
      wait_for_completion: true,
    });

    await this.client.indices.updateAliases({
      actions: [
        { remove: { index: oldIndex, alias: schema.alias } },
        { add: { index: schema.index, alias: schema.alias } },
      ],
    });

    if (options.deleteOldIndex === true) {
      await this.client.indices.delete({ index: oldIndex });
    }

    const result: MigrateResult = {
      fromIndex: oldIndex,
      toIndex: schema.index,
      documentsReindexed: (reindexResponse.created ?? 0) + (reindexResponse.updated ?? 0),
    };

    if (this.options.logger === true) {
      this.logger.log(
        `Migrated ${String(result.documentsReindexed)} docs: ${oldIndex} → ${schema.index}. Alias ${schema.alias} updated.`,
      );
    }

    return result;
  }

  /**
   * 인덱스 매핑을 코드와 동기화합니다.
   * - 인덱스가 없으면 `create()`를 호출합니다.
   * - Breaking 변경(필드 타입·분석기 변경)이 감지되면 `BreakingSchemaChangeError`를 던집니다.
   * - 추가 필드만 있으면 `PUT /{index}/_mapping`으로 반영합니다.
   *
   * @param target - `@EsIndex`가 선언된 스키마 클래스
   * @throws `BreakingSchemaChangeError` — 재인덱싱이 필요한 변경이 감지된 경우
   */
  async syncMapping<TDocument extends object>(target: EsDocumentClass<TDocument>): Promise<void> {
    if (!(await this.exists(target))) {
      await this.create(target);
      return;
    }

    const schema = this.schemaBuilder.build(target);
    const diff = await this.diff(target);

    if (diff.isBreaking) {
      throw new BreakingSchemaChangeError(
        `Breaking Elasticsearch schema change detected for ${schema.alias}: ${diff.changedFields
          .map((field) => field.field)
          .join(', ')}. Reindex migration is required.`,
      );
    }

    if (diff.addedFields.length > 0) {
      const properties = Object.fromEntries(
        diff.addedFields.flatMap((field) => {
          const property = schema.mappings.properties[field];
          return property === undefined ? [] : [[field, property]];
        }),
      ) as Record<string, estypes.MappingProperty>;
      await this.client.indices.putMapping({ index: schema.index, properties });
    }
  }
}
