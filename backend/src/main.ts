import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  });

  configureApp(app);

  const port = process.env.PORT || 3001;

  await app.listen(port);

  console.log(`Backend running at http://localhost:${port}/api`);
}

bootstrap();
