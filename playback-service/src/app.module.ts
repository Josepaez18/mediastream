import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConsoleConfigController } from './console-config.controller';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { CatalogModule } from './catalog/catalog.module';
import { PlaybackModule } from './playback/playback.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    CatalogModule,
    PlaybackModule,
    HealthModule,
  ],
  controllers: [ConsoleConfigController],
})
export class AppModule {}
