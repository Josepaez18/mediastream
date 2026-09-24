import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';

@Module({
  imports: [RabbitmqModule],
  controllers: [HealthController],
})
export class HealthModule {}
