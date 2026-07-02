import { Client } from '@elastic/elasticsearch';
import type { OnModuleInit, Provider } from '@nestjs/common';

import { ES_KIT_CLIENT, ES_KIT_OPTIONS, getIndexServiceToken } from '../constants.js';
import { EsIndexService } from '../services/es-index.service.js';
import { EsIndexManager } from '../services/index-manager.service.js';
import type { EsDocumentClass, EsKitModuleOptions } from '../types.js';

export const createClientProvider = (): Provider => ({
  provide: ES_KIT_CLIENT,
  inject: [ES_KIT_OPTIONS],
  useFactory: (options: EsKitModuleOptions): Client => new Client(options),
});

export const createSchemaProvider = (schemas: EsDocumentClass[]): Provider => ({
  provide: 'ES_KIT_SCHEMAS',
  useValue: schemas,
});

export const createIndexServiceProviders = (schemas: EsDocumentClass[]): Provider[] =>
  schemas.map((schema) => ({
    provide: getIndexServiceToken(schema),
    inject: [ES_KIT_CLIENT],
    useFactory: (client: Client): EsIndexService<object> => new EsIndexService(client, schema),
  }));

export const createFeatureInitializerProvider = (schemas: EsDocumentClass[]): Provider => ({
  provide: `ES_KIT_FEATURE_INITIALIZER_${schemas.map((schema) => schema.name).join('_')}`,
  inject: [EsIndexManager],
  useFactory: (manager: EsIndexManager): OnModuleInit => ({
    async onModuleInit(): Promise<void> {
      manager.setSchemas(schemas);
      await manager.onModuleInit();
    },
  }),
});

export const coreProviders = [createClientProvider(), EsIndexManager];
