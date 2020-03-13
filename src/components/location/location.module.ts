import { Module } from '@nestjs/common';
import { UserModule } from '../user';
import { LocationResolver } from './location.resolver';
import { LocationService } from './location.service';

@Module({
  imports: [UserModule],
  providers: [LocationResolver, LocationService],
  exports: [LocationService],
})
export class LocationModule {}
