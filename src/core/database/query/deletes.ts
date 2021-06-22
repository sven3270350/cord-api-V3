import { stripIndent } from 'common-tags';
import { node, Query, relation } from 'cypher-query-builder';
import { DateTime } from 'luxon';
import { ResourceShape } from '../../../common';

export const deleteBaseNode = (query: Query) =>
  query
    .match([
      node('baseNode'),
      /**
         in this case we want to set Deleted_ labels for all properties
         including active = false
         deleteProperties does this, but deletes from before that was changed only prefixed
         unique property labels
         */
      relation('out', ''),
      node('propertyNode', 'Property'),
    ])
    // Mark any parent base node relationships (pointing to the base node) as active = false.
    .optionalMatch([
      node('baseNode'),
      relation('in', 'baseNodeRel'),
      node('', 'BaseNode'),
    ])
    .setValues({
      'baseNode.deletedAt': DateTime.local(),
      'baseNodeRel.active': false,
    })
    /**
       if we set anything on property nodes or property relationships in the query above (as was done previously)
       we need to distinct propertyNode to avoid collecting and labeling each propertyNode more than once
       */
    .with('[baseNode] + collect(propertyNode) as nodeList')
    .raw('unwind nodeList as node')
    .apply(prefixNodeLabelsWithDeleted('node'));

/**
 * This will set all relationships given to active false
 * and add deleted prefix to its labels.
 */
export const deleteProperties =
  <Resource extends ResourceShape<any>>(
    _resource: Resource,
    ...relationLabels: ReadonlyArray<keyof Resource['prototype']>
  ) =>
  (query: Query) => {
    if (relationLabels.length === 0) {
      return query;
    }
    const deletedAt = DateTime.local();
    return query.subQuery((sub) =>
      sub
        .with('node')
        .match([
          node('node'),
          relation('out', 'propertyRel', relationLabels, { active: true }),
          node('property', 'Property'),
        ])
        .setValues({
          'property.deletedAt': deletedAt,
          'propertyRel.active': false,
        })
        .with('property')
        .apply(prefixNodeLabelsWithDeleted('property'))
        .return('count(property) as numPropsDeactivated')
    );
  };

export const prefixNodeLabelsWithDeleted = (node: string) => (query: Query) =>
  query.subQuery((sub) =>
    sub
      .with([
        node,
        // Mpa current labels to have deleted prefix (operation is idempotent).
        stripIndent`
          reduce(
            deletedLabels = [], label in labels(${node}) |
              case
                when label starts with "Deleted_" then deletedLabels + label
                else deletedLabels + ("Deleted_" + label)
              end
          ) as deletedLabels
        `,
      ])
      // yielding node is necessary even though unused
      .raw(
        `call apoc.create.removeLabels(${node}, labels(${node})) yield node as nodeRemoved`
      )
      .with([node, 'deletedLabels']) // Is this really needed?
      .raw(
        `call apoc.create.addLabels(${node}, deletedLabels) yield node as nodeAdded`
      )
      .return('1')
  );
