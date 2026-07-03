import { Module } from '@nestjs/common';
import { EsKitModule } from 'nestjs-es-kit';
import { Product } from './product.schema';
import { ProductService } from './product.service';

@Module({
  imports: [EsKitModule.forFeature([Product])],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}
