/**
 * BOS Core — WatermelonDB Migrations
 * ---------------------------------------------------------------------------
 * Never edit an existing step; append a new toVersion instead. Existing
 * installs replay only the steps they're missing.
 */

import {
  addColumns,
  createTable,
  schemaMigrations,
} from '@nozbe/watermelondb/Schema/migrations';
import { TableName } from './schema';

export const migrations = schemaMigrations({
  migrations: [
    {
      // v2 -> v3: sensor bindings on triggers (Sprint 8)
      toVersion: 3,
      steps: [
        addColumns({
          table: TableName.TRIGGERS,
          columns: [{ name: 'sensor_binding', type: 'string', isOptional: true }],
        }),
      ],
    },
    {
      // v1 -> v2: end-of-day reflections (Sprint 5)
      toVersion: 2,
      steps: [
        createTable({
          name: TableName.REFLECTIONS,
          columns: [
            { name: 'behavior_id', type: 'string', isIndexed: true },
            { name: 'control_rating', type: 'number', isOptional: true },
            { name: 'note', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number', isIndexed: true },
          ],
        }),
      ],
    },
  ],
});
