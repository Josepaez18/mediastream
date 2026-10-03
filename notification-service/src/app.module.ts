import { Module } from '@nestjs/common';
import { EventsModule } from './events/events.module';
import { HealthController } from './health/health.controller';
import { NotificationsModule } from './notifications/notifications.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [RedisModule, NotificationsModule, EventsModule],
  controllers: [HealthController],
})
export class AppModule {}
