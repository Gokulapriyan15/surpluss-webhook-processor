
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],

      useFactory: (configService: ConfigService) => ({
        type: 'postgres',

        host: configService.get<string>('DATABASE_HOST'),
        port: Number(configService.get('DATABASE_PORT') ?? 5432),

        username: configService.get<string>('DATABASE_USERNAME'),
        password: configService.get<string>('DATABASE_PASSWORD'),
        database: configService.get<string>('DATABASE_NAME'),

        autoLoadEntities: true,
        synchronize: false,
        retryAttempts: 5,
        retryDelay: 3000,
      }),
    }),
  ],

  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
