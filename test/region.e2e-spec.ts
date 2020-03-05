import { gql } from 'apollo-server-core';
import * as faker from 'faker';
import { isValid } from 'shortid';
import { Region, Zone } from '../src/components/location';
import { User } from '../src/components/user';
import {
  createSession,
  createTestApp,
  createUser,
  fragments,
  TestApp,
} from './utility';
import { createRegion } from './utility/create-region';
import { createZone } from './utility/create-zone';

describe('Region e2e', () => {
  let app: TestApp;
  let director: User;
  let newDirector: User;
  let zone: Zone;

  beforeAll(async () => {
    app = await createTestApp();
    await createSession(app);
    director = await createUser(app);
    newDirector = await createUser(app);
    zone = await createZone(app, { directorId: director.id });
  });

  afterAll(async () => {
    await app.close();
  });

  it('create a region', async () => {
    const region = await createRegion(app, { directorId: director.id });
    expect(region.id).toBeDefined();
  });

  it('read one region by id', async () => {
    const region = await createRegion(app, { directorId: director.id });

    try {
      const { location: actual } = await app.graphql.query(
        gql`
          query region($id: ID!) {
            location(id: $id) {
              __typename
              ... on Region {
                ...region
                director {
                  value {
                    ...user
                  }
                  canEdit
                  canRead
                }
                zone {
                  value {
                    ...zone
                  }
                  canEdit
                  canRead
                }
              }
            }
          }
          ${fragments.region}
          ${fragments.zone}
          ${fragments.user}
        `,
        {
          id: region.id,
        }
      );

      expect(actual.id).toBe(region.id);
      expect(isValid(actual.id)).toBe(true);
      expect(actual.name).toEqual(region.name);
    } catch (e) {
      console.error(e);
      fail();
    }
  });

  it('update region', async () => {
    const region = await createRegion(app, { directorId: director.id });
    const newName = faker.company.companyName();

    const result = await app.graphql.mutate(
      gql`
        mutation updateRegion($input: UpdateRegionInput!) {
          updateRegion(input: $input) {
            region {
              ...region
              zone {
                value {
                  ...zone
                }
                canRead
                canEdit
              }
            }
          }
        }
        ${fragments.region}
        ${fragments.zone}
      `,
      {
        input: {
          region: {
            id: region.id,
            name: newName,
          },
        },
      }
    );
    const updated = result.updateRegion.region;
    expect(updated).toBeTruthy();
    expect(updated.id).toBe(region.id);
    expect(updated.name.value).toBe(newName);
  });

  it('update region`s zone', async () => {
    const region = await createRegion(app, { directorId: director.id });
    const newZone = await createZone(app, { directorId: newDirector.id });

    const result = await app.graphql.mutate(
      gql`
        mutation updateRegion($input: UpdateRegionInput!) {
          updateRegion(input: $input) {
            region {
              ...region
              zone {
                value {
                  ...zone
                }
              }
            }
          }
        }
        ${fragments.region}
        ${fragments.zone}
      `,
      {
        input: {
          region: {
            id: region.id,
            zoneId: newZone.id,
          },
        },
      }
    );
    const updated = result.updateRegion.region;

    expect(updated).toBeTruthy();
    expect(updated.id).toBe(region.id);
    expect(updated.zone.value.id).toBe(newZone.id);
  });

  it('update region`s director', async () => {
    const region = await createRegion(app, { directorId: director.id });

    const result = await app.graphql.mutate(
      gql`
        mutation updateRegion($input: UpdateRegionInput!) {
          updateRegion(input: $input) {
            region {
              ...region
              director {
                value {
                  ...user
                }
              }
            }
          }
        }
        ${fragments.region}
        ${fragments.user}
      `,
      {
        input: {
          region: {
            id: region.id,
            directorId: newDirector.id,
          },
        },
      }
    );
    const updated = result.updateRegion.region;

    expect(updated).toBeTruthy();
    expect(updated.id).toBe(region.id);
    expect(updated.director.value.id).toBe(newDirector.id);
  });

  it('delete region', async () => {
    const region = await createRegion(app, { directorId: director.id });

    try {
      const result = await app.graphql.mutate(
        gql`
          mutation deleteLocation($id: ID!) {
            deleteLocation(id: $id)
          }
        `,
        {
          id: region.id,
        }
      );
      const actual: Region | undefined = result.deleteLocation;
      expect(actual).toBeTruthy();
    } catch (e) {
      console.log(e);
      fail();
    }
  });

  it('returns a list of regions', async () => {
    await Promise.all(
      ['Mainlandia', 'Eastern Mainlandia'].map(e =>
        createRegion(app, { name: e, directorId: director.id, zoneId: zone.id })
      )
    );

    const { locations } = await app.graphql.query(gql`
      query {
        locations(input: { filter: { name: "Main", types: ["region"] } }) {
          items {
            ...region
          }
          hasMore
          total
        }
      }
      ${fragments.region}
    `);

    expect(locations.items.length).toBeGreaterThanOrEqual(2);
  });
});
