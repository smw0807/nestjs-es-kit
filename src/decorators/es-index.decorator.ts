import { getMetadataStorage } from '../metadata/metadata-storage.js';
import type { EsIndexOptions } from '../types.js';

export const EsIndex = (options: EsIndexOptions): ClassDecorator => {
  return (target) => {
    getMetadataStorage().setIndex(target, options);
  };
};
