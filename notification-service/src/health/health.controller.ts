import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlaybackEventsSubscriber } from '../events/playback-events.subscriber';
import { RabbitmqConsumer } from '../events/rabbitmq.consumer';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly redis: RedisService,
    private readonly rabbit: RabbitmqConsumer,
    private readonly playbackEvents: PlaybackEventsSubscriber,
  ) {}

  // El proceso está vivo.
  @Get()
  liveness() {
    return { status: 'ok', service: 'notification-service' };
  }

  // Puede atender tráfico. Solo Redis es obligatorio (es su almacenamiento);
  // RabbitMQ se reporta, pero si cae los eventos esperan en sus colas y el
  // historial sigue respondiendo.
  @Get('ready')
  async readiness() {
    const redisOk = await this.redis.ping();
    const checks = {
      redis: redisOk,
      rabbitmq: this.rabbit.isConnected(),
      playbackSubscriber: this.playbackEvents.isSubscribed(),
    };
    if (!redisOk) throw new ServiceUnavailableException({ status: 'unavailable', checks });
    return { status: 'ready', checks };
  }
}
