import pg from 'pg';
import { DataSource } from 'typeorm';

import { CreateWebhookTables1764200000000 } from '../../src/database/migrations/1764200000000-CreateWebhookTables';

import { testDbConfig } from './test-config';

let prepared: Promise<void> | undefined;

/**
 * Creates the `*_test` database if it is missing and applies the REAL
 * migrations to it, so tests run against the production schema.
 * Safe to call from every test file; the work happens once per process.
 */
export function ensureTestDatabase(): Promise<void> {
  prepared ??= prepare();

  return prepared;
}

async function prepare(): Promise<void> {
  const admin = new pg.Client({
    host: testDbConfig.host,
    port: testDbConfig.port,
    user: testDbConfig.username,
    password: testDbConfig.password,
    database: 'postgres',
  });

  await admin.connect();

  try {
    const existing = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [testDbConfig.database],
    );

    if (existing.rowCount === 0) {
      // Identifiers cannot be parameterised; the name comes from our own
      // config and is validated to end in `_test`.
      await admin.query(`CREATE DATABASE "${testDbConfig.database}"`);
    }
  } finally {
    await admin.end();
  }

  const dataSource = new DataSource({
    type: 'postgres',
    ...testDbConfig,
    migrations: [CreateWebhookTables1764200000000],
  });

  await dataSource.initialize();

  try {
    await dataSource.runMigrations({ transaction: 'each' });
  } finally {
    await dataSource.destroy();
  }
}
