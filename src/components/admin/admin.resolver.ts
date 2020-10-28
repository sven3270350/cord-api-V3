import { Mutation, Resolver } from '@nestjs/graphql';
import { AdminService } from './admin.service';

@Resolver()
export class AdminResolver {
  constructor(private readonly adminService: AdminService) {}
  @Mutation(() => Boolean)
  async addRolesToBetaTesters(): Promise<boolean> {
    await this.adminService.addRolesToBetaTesters();
    return true;
  }
}
