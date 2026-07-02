import { DynamicModule, Module } from '@nestjs/common';

import { ES_KIT_OPTIONS } from '../constants.js';
import {
  coreProviders,
  createFeatureInitializerProvider,
  createIndexServiceProviders,
  createSchemaProvider,
} from './es-kit.providers.js';
import type { EsDocumentClass, EsKitModuleAsyncOptions, EsKitModuleOptions } from '../types.js';

@Module({})
export class EsKitModule {
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
