import { Module } from '@nestjs/common';
import { FileModule } from '../file';
import { PartnershipResolver } from './partnership.resolver';
import { PartnershipService } from './partnership.service';

@Module({
  imports: [FileModule],
  providers: [PartnershipResolver, PartnershipService],
  exports: [PartnershipService],
})
export class PartnershipModule {}
