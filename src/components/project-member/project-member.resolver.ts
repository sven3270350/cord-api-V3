import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { IdArg } from '../../common';
import { ISession, Session } from '../auth';
import {
  CreateProjectMemberInput,
  CreateProjectMemberOutput,
  ProjectMember,
  ProjectMemberListInput,
  ProjectMemberListOutput,
  UpdateProjectMemberInput,
  UpdateProjectMemberOutput,
} from './dto';
import { ProjectMemberService } from './project-member.service';

@Resolver()
export class ProjectMemberResolver {
  constructor(private readonly service: ProjectMemberService) {}

  @Mutation(() => CreateProjectMemberOutput, {
    description: 'Create a Project member',
  })
  async createProjectMember(
    @Session() session: ISession,
    @Args('input') { projectMember: input }: CreateProjectMemberInput
  ): Promise<CreateProjectMemberOutput> {
    const projectMember = await this.service.create(input, session);
    return { projectMember };
  }

  @Query(() => ProjectMember, {
    description: 'Look up a projectMember by ID',
  })
  async projectMember(
    @Session() session: ISession,
    @IdArg() id: string
  ): Promise<ProjectMember> {
    return await this.service.readOne(id, session);
  }

  @Query(() => ProjectMemberListOutput, {
    description: 'Look up projectMembers',
  })
  async projectMembers(
    @Session() session: ISession,
    @Args({
      name: 'input',
      type: () => ProjectMemberListInput,
      defaultValue: ProjectMemberListInput.defaultVal,
    })
    input: ProjectMemberListInput
  ): Promise<ProjectMemberListOutput> {
    return this.service.list(input, session);
  }

  @Mutation(() => UpdateProjectMemberOutput, {
    description: 'Update a ProjectMember',
  })
  async updateProjectMember(
    @Session() session: ISession,
    @Args('input') { projectMember: input }: UpdateProjectMemberInput
  ): Promise<UpdateProjectMemberOutput> {
    const projectMember = await this.service.update(input, session);
    return { projectMember };
  }

  @Mutation(() => Boolean, {
    description: 'Delete a ProjectMember',
  })
  async deleteProjectMember(
    @Session() session: ISession,
    @IdArg() id: string
  ): Promise<boolean> {
    await this.service.delete(id, session);
    return true;
  }
}
