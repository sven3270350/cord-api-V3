import { stripIndent } from 'common-tags';
import { Field, InputType, ObjectType } from 'type-graphql';
import { User } from '../user';

@ObjectType()
export abstract class SessionOutput {
  @Field({
    nullable: true,
    description: stripIndent`
      Use this token in future requests in the Authorization header.
      Authorization: Bearer {token}.
      This token is only returned when the \`browser\` argument is not set to \`true\`.`,
  })
  token?: string;

  @Field(() => User, {
    nullable: true,
    description:
      'Only returned if there is a logged-in user tied to the current session.',
  })
  user: User | null;
}

@InputType()
export abstract class LoginInput {
  @Field()
  email: string;

  @Field()
  password: string;
}

@ObjectType()
export class LoginOutput {
  @Field()
  success: boolean;

  @Field({
    nullable: true,
    description: 'Only returned if login was successful',
  })
  user?: User;

  // TODO Global Permissions
}

@InputType()
export abstract class ResetPasswordInput {
  @Field()
  readonly token: string;

  @Field()
  readonly password: string;
}
