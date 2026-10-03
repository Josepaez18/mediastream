import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';

// El enrutamiento no son controladores de Nest: es un middleware de Express
// (proxy/gateway.middleware.ts) registrado en main.ts antes que las rutas,
// para reenviar el cuerpo de cada petición tal cual (incluidas las subidas
// de vídeo a Media-Processing) sin parsearlo.
@Module({
  controllers: [HealthController],
})
export class AppModule {}
