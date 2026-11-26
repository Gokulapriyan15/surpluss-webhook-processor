import 'dotenv/config';

import { join } from 'path';
import { DataSource } from 'typeorm';

// Works both from TypeScript sources (ts-node, `src/`) and from the compiled
// build (`dist/`, used in Docker): pick the glob extension that matches how
// this file itself is being executed. `*.js` deliberately excludes `.d.ts`.
const ext = __filename.endsWith('.ts') ? 'ts' : 'js';

const AppDataSource = new DataSource({
  type: 'postgres',

  host: process.env.DATABASE_HOST || 'localhost',
  port: Number(process.env.DATABASE_PORT || 5432),

  username: process.env.DATABASE_USERNAME || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'postgres',
  database: process.env.DATABASE_NAME || 'webhook_processor',

  entities: [join(__dirname, '..', '**', `*.entity.${ext}`)],

  migrations: [join(__dirname, 'migrations', `*.${ext}`)],

  synchronize: false,

  logging: ['error', 'migration'],
});

export default AppDataSource;
