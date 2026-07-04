import { Inject, Injectable, Logger, type OnModuleInit, Optional } from '@nestjs/common';
import type { estypes } from '@elastic/elasticsearch';

import { ES_KIT_CLIENT, ES_KIT_OPTIONS } from '../constants.js';
import { BreakingSchemaChangeError, MigrationError } from '../errors/index.js';
import { SchemaBuilder } from '../metadata/schema-builder.js';
import { diffMappings } from '../migration/schema-diff.js';
import type { EsClient, EsDocumentClass, EsKitModuleOptions, MigrateOptions, MigrateResult, SchemaDiff } from '../types.js';

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

  async onModuleInit(): Promise<void> {
    await this.synchronizeSchemas(this.schemas);
  }

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

  async exists<TDocument extends object>(target: EsDocumentClass<TDocument>): Promise<boolean> {
    const schema = this.schemaBuilder.build(target);
    return this.client.indices.exists({ index: schema.index });
  }

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

  async delete<TDocument extends object>(target: EsDocumentClass<TDocument>, options: { force?: boolean } = {}): Promise<void> {
    if (options.force !== true) {
      throw new Error('Deleting an index requires { force: true }.');
    }

    const schema = this.schemaBuilder.build(target);
    await this.client.indices.delete({ index: schema.index });
  }

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
