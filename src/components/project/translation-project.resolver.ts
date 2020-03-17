import { Args, Parent, ResolveProperty, Resolver } from '@nestjs/graphql';
import { ISession, Session } from '../auth';
import {
  EngagementListInput,
  SecuredLanguageEngagementList,
} from '../engagement/dto';
import {
  ProjectMemberListInput,
  SecuredProjectMemberList,
} from '../project-member';
import { TranslationProject } from './dto';
import { ProjectService } from './project.service';

@Resolver(TranslationProject.classType)
export class TranslationProjectResolver {
  constructor(private readonly projects: ProjectService) {}

  @ResolveProperty(() => SecuredLanguageEngagementList)
  async engagements(
    @Parent() project: TranslationProject,
    @Session() session: ISession,
    @Args({
      name: 'input',
      type: () => EngagementListInput,
      nullable: true,
      defaultValue: EngagementListInput.defaultVal,
    })
    input: EngagementListInput
  ): Promise<SecuredLanguageEngagementList> {
    return this.projects.listEngagements(project, input, session);
  }

  @ResolveProperty(() => SecuredProjectMemberList, {
    description: 'projectMembers by project',
  })
  async team(
    @Session() session: ISession,
    @Parent() { id }: TranslationProject,
    @Args({
      name: 'input',
      type: () => ProjectMemberListInput,
      defaultValue: ProjectMemberListInput.defaultVal,
    })
    input: ProjectMemberListInput
  ): Promise<SecuredProjectMemberList> {
    return this.projects.listProjectMembers(id, input, session);
  }
}
