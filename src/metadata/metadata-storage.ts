import type { EsDocumentClass, EsFieldMetadata, EsIndexOptions } from '../types.js';

type MetadataTarget = object;

interface StoredMetadata {
  index?: EsIndexOptions;
  fields: EsFieldMetadata[];
}

class EsMetadataStorage {
  private readonly metadata = new Map<MetadataTarget, StoredMetadata>();

  setIndex(target: MetadataTarget, options: EsIndexOptions): void {
    const current = this.getOrCreate(target);
    current.index = options;
  }

  addField(target: MetadataTarget, field: EsFieldMetadata): void {
    const current = this.getOrCreate(target);
    const nextFields = current.fields.filter((item) => item.propertyKey !== field.propertyKey);
    current.fields = [...nextFields, field];
  }

  getIndex(target: MetadataTarget): EsIndexOptions | undefined {
    return this.metadata.get(target)?.index;
  }

  getFields(target: MetadataTarget): EsFieldMetadata[] {
    return [...(this.metadata.get(target)?.fields ?? [])];
  }

  getSchemaTargets(): MetadataTarget[] {
    return [...this.metadata.entries()]
      .filter(([, value]) => value.index !== undefined)
      .map(([target]) => target);
  }

  clear(): void {
    this.metadata.clear();
  }

  private getOrCreate(target: MetadataTarget): StoredMetadata {
    const current = this.metadata.get(target);
    if (current !== undefined) {
      return current;
    }

    const created: StoredMetadata = { fields: [] };
    this.metadata.set(target, created);
    return created;
  }
}

export const metadataStorage = new EsMetadataStorage();

export const getMetadataStorage = (): EsMetadataStorage => metadataStorage;

export const resolveTarget = <TDocument extends object>(target: EsDocumentClass<TDocument>): MetadataTarget => target;
