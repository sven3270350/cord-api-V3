import { gql } from 'apollo-server-core';
import { isValidId } from '../../src/common';
import {
  CreateProjectMember,
  ProjectMember,
} from '../../src/components/project';
import {
  createPerson,
  createProject,
  fragments,
  Raw,
  TestApp,
} from '../utility';
import { getUserFromSession } from './create-session';

export async function createProjectMember(
  app: TestApp,
  input: Partial<CreateProjectMember> = {}
) {
  const projectMember: CreateProjectMember = {
    userId:
      input.userId ||
      (await getUserFromSession(app)).id ||
      (await createPerson(app)).id,
    projectId: input.projectId ?? (await createProject(app)).id,
    ...input,
  };

  const result = await app.graphql.mutate(
    gql`
      mutation createProjectMember($input: CreateProjectMemberInput!) {
        createProjectMember(input: $input) {
          projectMember {
            ...projectMember
          }
        }
      }
      ${fragments.projectMember}
    `,
    {
      input: {
        projectMember,
      },
    }
  );

  const actual: Raw<ProjectMember> = result.createProjectMember.projectMember;

  expect(actual).toBeTruthy();
  expect(isValidId(actual.id)).toBe(true);
  return actual;
}
