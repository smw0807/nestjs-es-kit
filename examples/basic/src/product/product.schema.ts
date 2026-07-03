import { EsField, EsIndex, koreanAnalysis } from 'nestjs-es-kit';

export class Seller {
  @EsField({ type: 'keyword' })
  id!: string;

  @EsField({ type: 'keyword' })
  name!: string;
}

@EsIndex({
  name: 'products',
  useAlias: true,
  settings: {
    numberOfShards: 1,
    numberOfReplicas: 0,
    analysis: koreanAnalysis(),
  },
  dynamicTemplates: [
    {
      name: 'strings_as_keyword',
      matchMappingType: 'string',
      mapping: { type: 'keyword' },
    },
  ],
})
export class Product {
  @EsField({ type: 'keyword' })
  id!: string;

  @EsField({
    type: 'text',
    analyzer: 'nori_analyzer',
    fields: { raw: { type: 'keyword' } },
  })
  name!: string;

  @EsField({ type: 'keyword' })
  category!: string;

  @EsField({ type: 'integer' })
  price!: number;

  @EsField({ type: 'boolean' })
  inStock!: boolean;

  @EsField({ type: 'date' })
  createdAt!: string;

  @EsField({ type: 'object', properties: () => Seller })
  seller?: Seller;
}
