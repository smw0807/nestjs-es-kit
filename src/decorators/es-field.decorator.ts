import { getMetadataStorage } from '../metadata/metadata-storage.js';
import type { EsFieldOptions } from '../types.js';

/**
 * 클래스 프로퍼티를 Elasticsearch 필드로 선언합니다.
 *
 * @example
 * ```ts
 * @EsField({ type: 'text', analyzer: 'nori_analyzer' })
 * name: string;
 *
 * @EsField({ type: 'keyword' })
 * id: string;
 *
 * @EsField({ type: 'object', properties: () => Seller })
 * seller?: Seller;
 * ```
 */
export const EsField = (options: EsFieldOptions): PropertyDecorator => {
  return (target, propertyKey) => {
    getMetadataStorage().addField(target.constructor, {
      ...options,
      propertyKey: String(propertyKey),
    });
  };
};
