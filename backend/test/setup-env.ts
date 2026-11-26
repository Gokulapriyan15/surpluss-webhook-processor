import { Logger } from '@nestjs/common';

import { testDbConfig } from './helpers/test-config';

// Point the application at the test database. ConfigModule never overrides
// variables that are already set, so these win over backend/.env.
process.env.DATABASE_HOST = testDbConfig.host;
process.env.DATABASE_PORT = String(testDbConfig.port);
process.env.DATABASE_USERNAME = testDbConfig.username;
process.env.DATABASE_PASSWORD = testDbConfig.password;
process.env.DATABASE_NAME = testDbConfig.database;

// Tests drive workers by hand; no background loop inside the app under test.
process.env.WORKER_ENABLED = 'false';
process.env.MAX_ATTEMPTS = '5';
process.env.WORKER_LEASE_SECONDS = '30';

// Keep test output readable.
Logger.overrideLogger(false);
