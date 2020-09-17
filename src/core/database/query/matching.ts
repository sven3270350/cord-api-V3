import { node, Query, relation } from 'cypher-query-builder';
import { Term } from 'cypher-query-builder/dist/typings/clauses/term-list-clause';
import { ISession } from '../../../common';
import { collect } from './cypher-functions';
import { mapping } from './mapping';

export const requestingUser = (session: ISession) =>
  node('requestingUser', 'User', {
    id: session.userId,
  });

export const permissionsOfNode = (nodeLabel?: string) => [
  relation('in', '', 'member'),
  node('', 'SecurityGroup'),
  relation('out', '', 'permission'),
  node('perms', 'Permission'),
  relation('out', '', 'baseNode'),
  node('node', nodeLabel),
];

export const matchPermList = (
  query: Query,
  user = 'requestingUser',
  ...withOther: Term[]
) =>
  query
    .optionalMatch([node(user), ...permissionsOfNode()])
    .with(['collect(distinct perms) as permList', 'node', ...withOther]);

export const matchPropList = (query: Query, ...withOther: Term[]) =>
  query
    .match([
      node('node'),
      relation('out', 'r', { active: true }),
      node('props', 'Property'),
    ])
    .with([
      collect(
        mapping({
          value: 'props.value',
          property: 'type(r)',
        }),
        'propList'
      ),
      'node',
      ...withOther,
    ]);
