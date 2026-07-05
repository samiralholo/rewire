/**
 * BOS Core — Database bootstrap (Expo / React Native, offline-first).
 */

import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from './schema';
import { migrations } from './migrations';
import { coreModelClasses } from './models';

const adapter = new SQLiteAdapter({
  schema,
  migrations,
  dbName: 'rewire_bos',
  jsi: true, // fast synchronous bridge on RN
  onSetUpError: (error) => {
    // Local-only DB: surface loudly in dev; hook into telemetry later.
    console.error('[BOS] Database failed to initialize', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: coreModelClasses,
});
