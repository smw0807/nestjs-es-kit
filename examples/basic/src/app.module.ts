import { Module } from '@nestjs/common';
import { EsKitModule } from 'nestjs-es-kit';
import { ProductModule } from './product/product.module';

@Module({
  imports: [
    /**
     * forRoot — static configuration
     *
     * All ClientOptions from @elastic/elasticsearch are supported.
     * The 'synchronize' option controls index lifecycle at bootstrap:
     *   'none'   — do nothing
     *   'create' — create index if it doesn't exist (default)
     *   'sync'   — create + add new fields; throw on breaking changes
     */
    EsKitModule.forRoot({
      node: process.env['ES_NODE'] ?? 'http://localhost:9200',
      ...(process.env['ES_USERNAME'] && process.env['ES_PASSWORD']
        ? {
            auth: {
              username: process.env['ES_USERNAME'],
              password: process.env['ES_PASSWORD'],
            },
          }
        : {}),
      tls: { rejectUnauthorized: false },
      synchronize: 'sync',
      logger: true,
    }),
    ProductModule,
  ],
})
export class AppModule {}
