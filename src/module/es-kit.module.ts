import { DynamicModule, Module } from '@nestjs/common';

import { ES_KIT_OPTIONS } from '../constants.js';
import {
  coreProviders,
  createFeatureInitializerProvider,
  createIndexServiceProviders,
  createSchemaProvider,
} from './es-kit.providers.js';
import type { EsDocumentClass, EsKitModuleAsyncOptions, EsKitModuleOptions } from '../types.js';

/**
 * nestjs-es-kit의 루트 모듈.
 * `forRoot()` 또는 `forRootAsync()`로 전역 등록하고,
 * 각 기능 모듈에서 `forFeature()`로 스키마를 등록합니다.
 */
@Module({})
export class EsKitModule {
  /**
   * 동기 옵션으로 전역 모듈을 등록합니다.
   *
   * @param options - ES 연결 정보 및 `synchronize` 전략
   * @example
   * ```ts
   * EsKitModule.forRoot({
   *   node: 'http://localhost:9200',
   *   synchronize: 'sync',
   * })
   * ```
   */
  static forRoot(options: EsKitModuleOptions): DynamicModule {
    return {
      module: EsKitModule,
      providers: [
        {
          provide: ES_KIT_OPTIONS,
          useValue: {
            synchronize: 'create',
            ...options,
          } satisfies EsKitModuleOptions,
        },
        createSchemaProvider([]),
        ...coreProviders,
      ],
      exports: [...coreProviders],
      global: true,
    };
  }

  /**
   * 비동기 팩토리로 전역 모듈을 등록합니다.
   * `ConfigService` 등 다른 프로바이더에 의존하는 설정에 사용합니다.
   *
   * @param options.useFactory - ES 옵션을 반환하는 비동기 팩토리 함수
   * @param options.inject - 팩토리에 주입할 프로바이더 목록
   * @param options.imports - 팩토리가 의존하는 모듈 목록
   * @example
   * ```ts
   * EsKitModule.forRootAsync({
   *   imports: [ConfigModule],
   *   inject: [ConfigService],
   *   useFactory: (config: ConfigService) => ({
   *     node: config.get('ES_NODE'),
   *   }),
   * })
   * ```
   */
  static forRootAsync(options: EsKitModuleAsyncOptions): DynamicModule {
    const module: DynamicModule = {
      module: EsKitModule,
      providers: [
        {
          provide: ES_KIT_OPTIONS,
          inject: options.inject ?? [],
          useFactory: async (...args: readonly unknown[]): Promise<EsKitModuleOptions> => ({
            synchronize: 'create',
            ...(await options.useFactory(...args)),
          }),
        },
        createSchemaProvider([]),
        ...coreProviders,
      ],
      exports: [...coreProviders],
      global: true,
    };

    if (options.imports !== undefined) {
      module.imports = options.imports;
    }

    return module;
  }

  /**
   * 기능 모듈에 스키마를 등록하고 `EsIndexService`를 제공합니다.
   * `@InjectIndex(Schema)`로 해당 서비스를 주입받을 수 있습니다.
   *
   * @param schemas - 등록할 스키마 클래스 배열
   * @example
   * ```ts
   * @Module({
   *   imports: [EsKitModule.forFeature([Product, Order])],
   * })
   * export class ProductModule {}
   * ```
   */
  static forFeature(schemas: EsDocumentClass[]): DynamicModule {
    const schemaProvider = createSchemaProvider(schemas);
    const indexServiceProviders = createIndexServiceProviders(schemas);
    const featureInitializerProvider = createFeatureInitializerProvider(schemas);

    return {
      module: EsKitModule,
      providers: [schemaProvider, featureInitializerProvider, ...indexServiceProviders],
      exports: indexServiceProviders,
    };
  }
}
