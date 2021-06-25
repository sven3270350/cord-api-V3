import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { AnonSession, ID, IdArg, Session } from '../../common';
import { Product } from '../product';
import { ProductProgress } from './dto';
import { ProductProgressService } from './product-progress.service';

@Resolver(Product)
export class ProductConnectionResolver {
  constructor(private readonly service: ProductProgressService) {}

  @ResolveField(() => [ProductProgress], {
    description: 'Progress for all reports of this product',
  })
  async progressReports(
    @Parent() product: Product,
    @AnonSession() session: Session
  ): Promise<readonly ProductProgress[]> {
    return await this.service.readAllByProduct(product.id, session);
  }

  @ResolveField(() => ProductProgress, {
    description: 'The progress of this product from a specific report',
    nullable: true,
  })
  async progressReport(
    @Parent() product: Product,
    @AnonSession() session: Session,
    @IdArg({ name: 'reportId', nullable: true }) reportId?: ID
  ): Promise<ProductProgress | undefined> {
    if (!reportId) {
      return;
    }
    return await this.service.readOne(reportId, product.id, session);
  }
}
