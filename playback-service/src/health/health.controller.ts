import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CatalogClient } from '../catalog/catalog.client';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly catalog: CatalogClient,
  ) {}

  // El proceso está vivo.
  @Get()
  @HttpCode(HttpStatus.OK)
  liveness() {
    return { status: 'ok', service: 'playback-service' };
  }

  // Puede atender tráfico. Postgres y Redis son obligatorios: sin ellos no se
  // puede registrar progreso ni emitir tokens. Catalog-Service se reporta pero
  // no bloquea el readiness, porque su caída solo degrada la emisión de tokens.
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  async readiness() {
    const [dbOk, redisOk, catalogOk] = await Promise.all([
      this.prisma.isHealthy(),
      this.redis.ping(),
      this.catalog.isReachable(),
    ]);

    const checks = {
      database: dbOk,
      redis: redisOk,
      catalogService: catalogOk,
      catalogCircuit: this.catalog.circuitState,
    };
    const allOk = dbOk && redisOk;

    if (!allOk) {
      throw new ServiceUnavailableException({ status: 'unavailable', checks });
    }

    return { status: 'ready', checks };
  }
}
