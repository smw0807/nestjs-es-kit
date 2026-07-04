import { getMetadataStorage } from '../metadata/metadata-storage.js';
import type { EsIndexOptions } from '../types.js';

/**
 * 클래스를 Elasticsearch 인덱스 스키마로 선언합니다.
 * `useAlias: true`(기본값)이면 물리 인덱스명은 `{name}-v{version}`,
 * 별칭(alias)은 `{name}`으로 생성됩니다.
 *
 * @example
 * ```ts
 * @EsIndex({
 *   name: 'products',
 *   useAlias: true,
 *   version: 1,
 *   settings: { numberOfShards: 3, analysis: koreanAnalysis() },
 * })
 * class Product { ... }
 * ```
 */
export const EsIndex = (options: EsIndexOptions): ClassDecorator => {
  return (target) => {
    getMetadataStorage().setIndex(target, options);
  };
};
