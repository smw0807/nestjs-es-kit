import { SchemaMetadataError } from '../errors/index.js';
import { getMetadataStorage } from './metadata-storage.js';
import type {
  EsDocumentClass,
  EsDynamicTemplate,
  EsFieldMapping,
  EsFieldMetadata,
  EsIndexOptions,
  EsSchema,
} from '../types.js';

/**
 * `@EsIndex` / `@EsField` 데코레이터 메타데이터를 읽어 `EsSchema`를 생성합니다.
 * 인덱스 이름, 별칭, 매핑 프로퍼티, 인덱스 설정을 하나의 스키마 객체로 조립합니다.
 */
export class SchemaBuilder {
  /**
   * 스키마 클래스에서 `EsSchema`를 빌드합니다.
   *
   * @param target - `@EsIndex`와 하나 이상의 `@EsField`가 선언된 클래스
   * @returns 물리 인덱스명, 별칭, 매핑, 설정을 포함한 스키마 객체
   * @throws `SchemaMetadataError` — `@EsIndex` 또는 `@EsField`가 없을 때
   */
  build<TDocument extends object>(target: EsDocumentClass<TDocument>): EsSchema {
    const storage = getMetadataStorage();
    const index = storage.getIndex(target);
    const fields = storage.getFields(target);

    if (index === undefined) {
      throw new SchemaMetadataError(`Missing @EsIndex metadata on ${target.name}.`);
    }

    if (fields.length === 0) {
      throw new SchemaMetadataError(`Index schema ${target.name} must declare at least one @EsField.`);
    }

    const useAlias = index.useAlias ?? true;
    const version = index.version ?? 1;
    const alias = index.name;
    const physicalIndex = useAlias ? `${index.name}-v${String(version)}` : index.name;

    const schema: EsSchema = {
      index: physicalIndex,
      alias,
      useAlias,
      mappings: {
        ...this.buildDynamicTemplates(index.dynamicTemplates),
        properties: this.buildProperties(fields),
      },
    };

    const settings = this.buildSettings(index);
    if (settings !== undefined) {
      schema.settings = settings;
    }

    return schema;
  }

  private buildSettings(index: EsIndexOptions): Record<string, unknown> | undefined {
    if (index.settings === undefined) {
      return undefined;
    }

    const settings: Record<string, unknown> = {};

    if (index.settings.numberOfShards !== undefined) {
      settings.number_of_shards = index.settings.numberOfShards;
    }

    if (index.settings.numberOfReplicas !== undefined) {
      settings.number_of_replicas = index.settings.numberOfReplicas;
    }

    if (index.settings.refreshInterval !== undefined) {
      settings.refresh_interval = index.settings.refreshInterval;
    }

    if (index.settings.analysis !== undefined) {
      settings.analysis = index.settings.analysis;
    }

    return Object.keys(settings).length > 0 ? settings : undefined;
  }

  private buildDynamicTemplates(
    templates: EsDynamicTemplate[] | undefined,
  ): Pick<EsSchema['mappings'], 'dynamic_templates'> {
    if (templates === undefined || templates.length === 0) {
      return {};
    }

    return {
      dynamic_templates: templates.map(({ name, ...template }) => ({
        [name]: this.mapDynamicTemplate(template),
      })),
    };
  }

  private mapDynamicTemplate(template: Omit<EsDynamicTemplate, 'name'>): Omit<EsDynamicTemplate, 'name'> {
    return {
      ...template,
      mapping: this.normalizeFieldMapping(template.mapping),
    };
  }

  private buildProperties(fields: EsFieldMetadata[]): Record<string, EsFieldMapping> {
    return Object.fromEntries(fields.map((field) => [field.propertyKey, this.buildField(field)]));
  }

  private buildField(field: EsFieldMetadata): EsFieldMapping {
    const mapping: EsFieldMapping = { type: field.type };

    if (field.analyzer !== undefined) {
      mapping.analyzer = field.analyzer;
    }

    if (field.searchAnalyzer !== undefined) {
      mapping.search_analyzer = field.searchAnalyzer;
    }

    if (field.fields !== undefined) {
      mapping.fields = field.fields;
    }

    if (field.index !== undefined) {
      mapping.index = field.index;
    }

    if (field.docValues !== undefined) {
      mapping.doc_values = field.docValues;
    }

    if (field.nullValue !== undefined) {
      mapping.null_value = field.nullValue;
    }

    if (field.format !== undefined) {
      mapping.format = field.format;
    }

    if ((field.type === 'object' || field.type === 'nested') && field.properties !== undefined) {
      mapping.properties = this.buildProperties(getMetadataStorage().getFields(field.properties()));
    }

    return mapping;
  }

  private normalizeFieldMapping(mapping: EsFieldMapping): EsFieldMapping {
    const normalized: EsFieldMapping = { type: mapping.type };

    if (mapping.analyzer !== undefined) {
      normalized.analyzer = mapping.analyzer;
    }

    if (mapping.search_analyzer !== undefined) {
      normalized.search_analyzer = mapping.search_analyzer;
    }

    if (mapping.fields !== undefined) {
      normalized.fields = mapping.fields;
    }

    if (mapping.index !== undefined) {
      normalized.index = mapping.index;
    }

    if (mapping.doc_values !== undefined) {
      normalized.doc_values = mapping.doc_values;
    }

    if (mapping.null_value !== undefined) {
      normalized.null_value = mapping.null_value;
    }

    if (mapping.format !== undefined) {
      normalized.format = mapping.format;
    }

    if (mapping.properties !== undefined) {
      normalized.properties = mapping.properties;
    }

    return normalized;
  }
}
