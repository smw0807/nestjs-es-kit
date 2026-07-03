import { Injectable } from '@nestjs/common';
import { EsIndexService, InjectIndex } from 'nestjs-es-kit';
import { Product } from './product.schema';

export interface CreateProductDto {
  id: string;
  name: string;
  category: string;
  price: number;
  inStock: boolean;
  seller?: { id: string; name: string };
}

@Injectable()
export class ProductService {
  constructor(
    @InjectIndex(Product) private readonly products: EsIndexService<Product>,
  ) {}

  async create(dto: CreateProductDto): Promise<string | undefined> {
    const doc: Product = {
      ...dto,
      createdAt: new Date().toISOString(),
    };
    return this.products.index(doc, { id: dto.id, refresh: 'wait_for' });
  }

  async findById(id: string): Promise<Product | null> {
    return this.products.get(id);
  }

  async updatePrice(id: string, price: number): Promise<void> {
    return this.products.update(id, { price }, { refresh: 'wait_for' });
  }

  async remove(id: string): Promise<void> {
    return this.products.delete(id, { refresh: 'wait_for' });
  }

  async bulkCreate(dtos: CreateProductDto[]) {
    const docs: Product[] = dtos.map((dto) => ({
      ...dto,
      createdAt: new Date().toISOString(),
    }));

    return this.products.bulkIndex(docs, {
      chunkSize: 500,
      retries: 3,
      idSelector: (doc) => doc.id,
      refresh: 'wait_for',
    });
  }

  async search(keyword: string, page = 0, size = 20) {
    return this.products.search({
      query: {
        bool: {
          must: [{ match: { name: keyword } }],
          filter: [{ term: { inStock: true } }],
        },
      },
      sort: [{ price: 'asc' }],
      size,
      from: page * size,
    });
  }

  async searchWithCursor(keyword: string, size = 20, cursor?: readonly unknown[]) {
    return this.products.searchAfter({
      query: { match: { name: keyword } },
      sort: [{ createdAt: 'desc' }, { id: 'asc' }],
      size,
      ...(cursor !== undefined ? { after: cursor } : {}),
    });
  }

  async statsByCategory() {
    return this.products.aggregate({
      byCategory: { terms: { field: 'category', size: 20 } },
      avgPrice: { avg: { field: 'price' } },
      priceRange: {
        stats: { field: 'price' },
      },
    });
  }
}
