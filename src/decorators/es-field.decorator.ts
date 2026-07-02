import { getMetadataStorage } from '../metadata/metadata-storage.js';
import type { EsFieldOptions } from '../types.js';

export const EsField = (options: EsFieldOptions): PropertyDecorator => {
  return (target, propertyKey) => {
    getMetadataStorage().addField(target.constructor, {
      ...options,
      propertyKey: String(propertyKey),
    });
  };
};
