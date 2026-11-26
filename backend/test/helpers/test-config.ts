/**
 * Connection settings for the dedicated test database.
 * The tests TRUNCATE tables, so the database name MUST end in `_test`.
 */
export const testDbConfig = {
  host: process.env.TEST_DATABASE_HOST ?? 'localhost',
  port: Number(process.env.TEST_DATABASE_PORT ?? 5432),
  username: process.env.TEST_DATABASE_USERNAME ?? 'postgres',
  password: process.env.TEST_DATABASE_PASSWORD ?? 'postgres',
  database: process.env.TEST_DATABASE_NAME ?? 'webhook_processor_test',
};

if (!testDbConfig.database.endsWith('_test')) {
  throw new Error(
    `Refusing to run tests against "${testDbConfig.database}": ` +
      'the test database name must end with "_test".',
  );
}
