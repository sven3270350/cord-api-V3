import { forwardRef, Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { EngagementModule } from '../engagement/engagement.module';
import { ProjectModule } from '../project/project.module';
import { ChangesetAwareResolver } from './changeset-aware.resolver';
import * as handlers from './handlers';
import { PlanChangeRepository } from './plan-change.repository';
import { PlanChangeResolver } from './plan-change.resolver';
import { PlanChangeService } from './plan-change.service';

@Module({
  imports: [
    AuthorizationModule,
    forwardRef(() => ProjectModule),
    forwardRef(() => EngagementModule),
  ],
  providers: [
    PlanChangeResolver,
    ChangesetAwareResolver,
    PlanChangeService,
    PlanChangeRepository,
    ...Object.values(handlers),
  ],
  exports: [PlanChangeService, PlanChangeRepository],
})
export class PlanChangeModule {}
