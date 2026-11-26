import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * Global HTTP configuration shared by the real server (main.ts) and the
 * integration tests, so the tests exercise exactly what production serves.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
