import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ContextFunction } from 'apollo-server-core';
import { Request, Response } from 'express';
import { GqlContextType } from './common';
import { DateScalar, DateTimeScalar } from './common/luxon.graphql';
import { AdminResolver } from './components/admin/admin.resolver';
import { AdminService } from './components/admin/admin.service';
import { AreaResolver } from './components/area/area.resolver';
import { AreaService } from './components/area/area.service';
import { AuthResolver } from './components/auth/auth.resolver';
import { AuthService } from './components/auth/auth.service';
import { BudgetResolver } from './components/budget/budget.resolver';
import { BudgetService } from './components/budget/budget.service';
import { AwsS3Factory } from './core/aws-s3.factory';
import { AwsS3Service } from './core/aws-s3.service';
import { InternshipResolver } from './components/internship/internship.resolver';
import { InternshipService } from './components/internship/internship.service';
import { InternshipEngagementResolver } from './components/internship-engagement/internship-engagement.resolver';
import { InternshipEngagementService } from './components/internship-engagement/internship-engagement.service';
import { LanguageResolver } from './components/language/language.resolver';
import { LanguageService } from './components/language/language.service';
import { LocationResolver } from './components/location/location.resolver';
import { LocationService } from './components/location/location.service';
import { OrganizationResolver } from './components/organization/organization.resolver';
import { OrganizationService } from './components/organization/organization.service';
import { PartnershipResolver } from './components/partnership/partnership.resolver';
import { PartnershipService } from './components/partnership/partnership.service';
import { ProductResolver } from './components/product/product.resolver';
import { ProductService } from './components/product/product.service';
import { ProjectEngagementResolver } from './components/project-engagement/project-engagement.resolver';
import { ProjectEngagementService } from './components/project-engagement/project-engagement.service';
import { ProjectResolver } from './components/project/project.resolver';
import { ProjectService } from './components/project/project.service';
import { RegionResolver } from './components/region/region.resolver';
import { RegionService } from './components/region/region.service';
import { UserResolver } from './components/user/user.resolver';
import { UserService } from './components/user/user.service';
import { CoreModule } from './core';

const context: ContextFunction<{ req: Request; res: Response }, GqlContextType> = ({
  req,
  res,
}) => ({
  token: req.header('token'),
});

@Module({
  imports: [
    CoreModule,
    GraphQLModule.forRoot({
      autoSchemaFile: 'schema.gql',
      context,
    }),
  ],
  controllers: [],
  providers: [
    AdminResolver,
    AdminService,
    AreaResolver,
    AreaService,
    AuthResolver,
    AuthService,
    AwsS3Service,
    AwsS3Factory,
    BudgetResolver,
    BudgetService,
    DateTimeScalar,
    DateScalar,
    InternshipResolver,
    InternshipService,
    InternshipEngagementResolver,
    InternshipEngagementService,
    LanguageResolver,
    LanguageService,
    LocationResolver,
    LocationService,
    OrganizationResolver,
    OrganizationService,
    ProductResolver,
    ProductService,
    ProjectEngagementResolver,
    ProjectEngagementService,
    ProjectResolver,
    ProjectService,
    RegionResolver,
    RegionResolver,
    RegionService,
    UserResolver,
    UserService,
    PartnershipResolver,
    PartnershipService,
  ],
})
export class AppModule {}
