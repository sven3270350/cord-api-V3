import { gql } from 'apollo-server-core';
import * as faker from 'faker';
import { times } from 'lodash';
import { generate, isValid } from 'shortid';
import { Song } from '../src/components/song/dto';
import {
  createSession,
  createSong,
  createTestApp,
  createUser,
  fragments,
  TestApp,
} from './utility';

describe('Song e2e', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
    await createSession(app);
    await createUser(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // Create SONG
  it('Create Song', async () => {
    const name = faker.company.companyName();
    await createSong(app, { name });
  });

  // READ SONG
  it('create & read song by id', async () => {
    const st = await createSong(app);

    const { song: actual } = await app.graphql.query(
      gql`
        query st($id: ID!) {
          song(id: $id) {
            ...song
          }
        }
        ${fragments.song}
      `,
      {
        id: st.id,
      }
    );
    expect(actual.id).toBe(st.id);
    expect(isValid(actual.id)).toBe(true);
    expect(actual.name.value).toBe(st.name.value);
  });

  // UPDATE SONG
  it('update song', async () => {
    const st = await createSong(app);
    const newName = faker.company.companyName();
    const result = await app.graphql.mutate(
      gql`
        mutation updateSong($input: UpdateSongInput!) {
          updateSong(input: $input) {
            song {
              ...song
            }
          }
        }
        ${fragments.song}
      `,
      {
        input: {
          song: {
            id: st.id,
            name: newName,
          },
        },
      }
    );
    const updated = result.updateSong.song;
    expect(updated).toBeTruthy();
    expect(updated.name.value).toBe(newName);
  });

  // DELETE SONG
  it('delete song', async () => {
    const st = await createSong(app);
    const result = await app.graphql.mutate(
      gql`
        mutation deleteSong($id: ID!) {
          deleteSong(id: $id)
        }
      `,
      {
        id: st.id,
      }
    );
    const actual: Song | undefined = result.deleteSong;
    expect(actual).toBeTruthy();
  });

  // LIST SONGs
  it('list view of songs', async () => {
    // create a bunch of songs
    const numSongs = 2;
    await Promise.all(
      times(numSongs).map(() => createSong(app, { name: generate() + ' Song' }))
    );

    const { songs } = await app.graphql.query(gql`
      query {
        songs(input: { count: 15, filter: { name: "Song" } }) {
          items {
            ...song
          }
          hasMore
          total
        }
      }
      ${fragments.song}
    `);

    expect(songs.items.length).toBeGreaterThanOrEqual(numSongs);
  });
});
