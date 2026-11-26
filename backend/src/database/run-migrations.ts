import AppDataSource from './data-source';

/**
 * One-shot migration runner used by the `migrate` service in Docker Compose.
 * Exits non-zero on failure so dependent services never start on a broken schema.
 */
async function runMigrations(): Promise<void> {
  await AppDataSource.initialize();

  try {
    const executed = await AppDataSource.runMigrations({
      transaction: 'each',
    });

    console.log(
      executed.length > 0
        ? `Applied migrations: ${executed.map((m) => m.name).join(', ')}`
        : 'Database schema is up to date',
    );
  } finally {
    await AppDataSource.destroy();
  }
}

runMigrations().catch((error: unknown) => {
  console.error('Migration failed', error);
  process.exit(1);
});
