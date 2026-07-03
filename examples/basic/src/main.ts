import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProductService } from './product/product.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const products = app.get(ProductService);

  // Bulk index sample data
  const result = await products.bulkCreate([
    { id: 'p1', name: '삼성 갤럭시북 노트북', category: 'electronics', price: 1_500_000, inStock: true },
    { id: 'p2', name: '애플 맥북 프로', category: 'electronics', price: 3_200_000, inStock: true },
    { id: 'p3', name: 'LG 그램 노트북', category: 'electronics', price: 1_800_000, inStock: false },
    { id: 'p4', name: '게이밍 의자', category: 'furniture', price: 450_000, inStock: true },
    { id: 'p5', name: '스탠딩 데스크', category: 'furniture', price: 650_000, inStock: true },
  ]);

  console.log('Bulk index result:', result);

  // Search Korean text (requires nori plugin)
  const searchResult = await products.search('노트북');
  console.log(`Search "노트북" — found ${searchResult.total} documents`);
  searchResult.hits.forEach((p) => console.log(`  [${p.id}] ${p.name} ₩${p.price.toLocaleString()}`));

  // search_after pagination
  const page1 = await products.searchWithCursor('노트북', 2);
  console.log(`Page 1 (size 2):`, page1.hits.map((p) => p.id));

  if (page1.nextCursor !== undefined) {
    const page2 = await products.searchWithCursor('노트북', 2, page1.nextCursor);
    console.log(`Page 2 (size 2):`, page2.hits.map((p) => p.id));
  }

  // Aggregation
  const aggs = await products.statsByCategory();
  const byCategory = aggs['byCategory'] as { buckets: { key: string; doc_count: number }[] };
  console.log('Products by category:', byCategory.buckets.map((b) => `${b.key}(${b.doc_count})`).join(', '));

  await app.close();
}

bootstrap().catch(console.error);
