import { ObjectType, registerEnumType } from '@nestjs/graphql';
import { SecuredEnumList } from '../../../common';

export enum Role {
  BibleTranslationLiaison = 'BibleTranslationLiaison',
  Consultant = 'Consultant',
  ConsultantManager = 'ConsultantManager',
  Controller = 'Controller',
  Development = 'Development',
  ExecutiveDevelopmentRepresentative = 'ExecutiveDevelopmentRepresentative',
  ExecutiveLeadership = 'ExecutiveLeadership',
  FieldOperationsDirector = 'FieldOperationsDirector',
  FieldPartner = 'FieldPartner',
  FinancialAnalyst = 'FinancialAnalyst',
  Intern = 'Intern',
  Liaison = 'Liaison',
  LeadFinancialAnalyst = 'LeadFinancialAnalyst',
  Mentor = 'Mentor',
  OfficeOfThePresident = 'OfficeOfThePresident',
  ProjectManager = 'ProjectManager',
  RegionalCommunicationsCoordinator = 'RegionalCommunicationsCoordinator',
  RegionalDirector = 'RegionalDirector',
  SupportingProjectManager = 'SupportingProjectManager',
  Translator = 'Translator',
  Writer = 'Writer',
}

registerEnumType(Role, { name: 'Role' });

@ObjectType({
  description: SecuredEnumList.descriptionFor('roles'),
})
export abstract class SecuredRoles extends SecuredEnumList(Role) {}

export enum InternalRole {
  // someone who needs access to all props of a base node
  Admin = 'Admin',
  // a project admin that needs minimal information on a team member of the same project
  AdminViewOfProjectMember = 'AdminViewOfProjectMember',
}
