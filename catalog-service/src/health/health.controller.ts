import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { MediaEventsConsumer } from '../rabbitmq/media-events.consumer';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mediaEventsConsumer: MediaEventsConsumer,
  ) {}

  // El proceso está vivo.
  @Get()
  @HttpCode(HttpStatus.OK)
  liveness() {
    return { status: 'ok', service: 'catalog-service' };
  }

  // Puede atender tráfico: su base de datos y su conexión a RabbitMQ/Redis responden.
  // Render usa este chequeo para decidir cuándo enrutarle tráfico a una nueva instancia.
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async readiness() {
    const [dbOk, redisOk] = await Promise.all([this.prisma.isHealthy(), this.redis.ping()]);
    const rabbitOk = this.mediaEventsConsumer.isConnected();

    const checks = { database: dbOk, redis: redisOk, rabbitmq: rabbitOk };
    const allOk = dbOk && redisOk; // rabbitmq degradado no bloquea lecturas del catálogo

    if (!allOk) {
      throw new ServiceUnavailableException({ status: 'unavailable', checks });
    }

    return { status: 'ready', checks };
  }
}
