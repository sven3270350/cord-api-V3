import { gql } from 'apollo-server-core';
import * as faker from 'faker';
import { generate, isValid } from 'shortid';
import { RegisterInput } from '../../src/components/authentication';
import { User, UserStatus } from '../../src/components/user';
import { TestApp } from './create-app';
import { fragments } from './fragments';

export const generateResisterInput = (): RegisterInput => ({
  email: `${faker.internet.email()} ${Date.now()}`,
  realFirstName: faker.name.firstName(),
  realLastName: faker.name.lastName(),
  displayFirstName: faker.name.firstName() + generate(),
  displayLastName: faker.name.lastName() + generate(),
  password: faker.internet.password(),
  phone: faker.phone.phoneNumber(),
  timezone: 'timezone detail',
  bio: 'bio detail',
  status: UserStatus.Active,
});

export async function registerUser(
  app: TestApp,
  input: Partial<RegisterInput> = {}
) {
  const user: RegisterInput = {
    ...generateResisterInput(),
    ...input,
  };

  const result = await app.graphql.mutate(
    gql`
      mutation createUser($input: RegisterInput!) {
        register(input: $input) {
          user {
            ...user
          }
        }
      }
      ${fragments.user}
    `,
    {
      input: user,
    }
  );

  const actual: User = result.register.user;
  expect(actual).toBeTruthy();

  expect(isValid(actual.id)).toBe(true);
  expect(actual.email.value).toBe(user.email);

  return actual;
}

/** @deprecated use registerUser instead */
export const createUser = registerUser;
