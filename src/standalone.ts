import 'reflect-metadata';

import { Client } from '@elastic/elasticsearch';

import { EsIndexManager } from './services/index-manager.service.js';
import type {
  EsDocumentClass,
  EsKitModuleOptions,
  MigrateOptions,
  MigrateResult,
  SchemaDiff,
} from './types.js';

/**
 * NestJS DI 없이 독립적으로 사용할 수 있는 인덱스 매니저.
 * 마이그레이션 스크립트, CLI, 테스트 등에서 사용합니다.
 *
 * @example
 * ```ts
 * // migrate.ts
 * import { EsStandaloneManager } from 'nestjs-es-kit/standalone';
 * import { ProductV2 } from './product.schema.js';
 *
 * const manager = new EsStandaloneManager({ node: 'http://localhost:9200' });
 * const result = await manager.migrate(ProductV2, { deleteOldIndex: true });
 * console.log(result);
 * ```
 */
export class EsStandaloneManager {
  private readonly manager: EsIndexManager;

  constructor(options: EsKitModuleOptions) {
    const client = new Client(options);
    this.manager = new EsIndexManager(client, { ...options, synchronize: 'none' });
  }

  /**
   * 스키마에 해당하는 물리 인덱스가 ES에 존재하는지 확인합니다.
   */
  async exists<TDocument extends object>(target: EsDocumentClass<TDocument>): Promise<boolean> {
    return this.manager.exists(target);
  }

  /**
   * 스키마를 기반으로 ES 인덱스를 생성합니다.
   * 이미 존재하면 아무 작업도 하지 않습니다.
   */
  async create<TDocument extends object>(target: EsDocumentClass<TDocument>): Promise<void> {
    return this.manager.create(target);
  }

  /**
   * 코드 매핑·설정과 ES 실제 상태의 차이를 반환합니다.
   */
  async diff<TDocument extends object>(target: EsDocumentClass<TDocument>): Promise<SchemaDiff> {
    return this.manager.diff(target);
  }

  /**
   * 인덱스 매핑·설정을 코드와 동기화합니다.
   * 동적 설정은 자동 반영하고, breaking 변경은 에러를 던집니다.
   */
  async sync<TDocument extends object>(target: EsDocumentClass<TDocument>): Promise<void> {
    return this.manager.syncMapping(target);
  }

  /**
   * 별칭 스왑 방식의 무중단 인덱스 마이그레이션을 수행합니다.
   */
  async migrate<TDocument extends object>(
    target: EsDocumentClass<TDocument>,
    options?: MigrateOptions,
  ): Promise<MigrateResult> {
    return this.manager.migrate(target, options);
  }
}
