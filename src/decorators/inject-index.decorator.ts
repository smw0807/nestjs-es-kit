import { Inject } from '@nestjs/common';

import { getIndexServiceToken } from '../constants.js';
import type { EsDocumentClass } from '../types.js';

/**
 * 생성자 파라미터에 `EsIndexService<T>`를 주입합니다.
 * `EsKitModule.forFeature([Schema])`로 등록된 스키마에만 사용 가능합니다.
 *
 * @example
 * ```ts
 * constructor(
 *   @InjectIndex(Product) private readonly products: EsIndexService<Product>,
 * ) {}
 * ```
 */
export const InjectIndex = <TDocument extends object>(target: EsDocumentClass<TDocument>): ParameterDecorator =>
  Inject(getIndexServiceToken(target));
