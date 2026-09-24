import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PlaybackController } from './playback.controller';
import { PlaybackService } from './playback.service';

@Module({
  imports: [
    // Clave de firma del token DRM simulado. En producción esto sería la
    // clave de integración con el proveedor real (Widevine / FairPlay).
    JwtModule.register({
      secret: process.env.DRM_JWT_SECRET ?? 'dev-drm-secret-cambiar-en-produccion',
      signOptions: { issuer: 'playback-service' },
    }),
  ],
  controllers: [PlaybackController],
  providers: [PlaybackService],
  exports: [PlaybackService],
})
export class PlaybackModule {}
