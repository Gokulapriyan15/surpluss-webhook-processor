import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from './app.module';

/**
 * Standalone worker process: no HTTP server, only the background loop.
 * Each worker container runs this entry point with its own WORKER_ID.
 */
async function bootstrap() {
  // The worker loop is opt-in per process (see WorkerService.onModuleInit).
  process.env.WORKER_ENABLED = 'true';

  const app = await NestFactory.createApplicationContext(AppModule);

  // Lets `docker stop` (SIGTERM) stop the polling loop cleanly.
  app.enableShutdownHooks();

  new Logger('Worker').log('Worker process ready');
}

bootstrap().catch((error: unknown) => {
  console.error('Worker failed to start', error);
  process.exit(1);
});
