import { Inject } from '@nestjs/common';

import { getIndexServiceToken } from '../constants.js';
import type { EsDocumentClass } from '../types.js';

export const InjectIndex = <TDocument extends object>(target: EsDocumentClass<TDocument>): ParameterDecorator =>
  Inject(getIndexServiceToken(target));
