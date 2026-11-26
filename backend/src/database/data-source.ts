
import 'dotenv/config';

import { DataSource } from 'typeorm';

const AppDataSource = new DataSource({
  type: 'postgres',

  host: process.env.DATABASE_HOST || 'localhost',
  port: Number(process.env.DATABASE_PORT || 5432),

  username: process.env.DATABASE_USERNAME || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'postgres',
  database: process.env.DATABASE_NAME || 'webhook_processor',

  entities: ['src/**/*.entity.ts'],

  migrations: ['src/database/migrations/*.ts'],

  synchronize: false,

  logging: true,
});

export default AppDataSource;
