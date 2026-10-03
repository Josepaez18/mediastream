import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { allowedCorsOrigins } from './public-urls';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  app.use(new RequestIdMiddleware().use);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: allowedCorsOrigins() });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Notification-Service')
    .setDescription(
      'MediaStream — Avisa de nuevos estrenos, de la continuación de series en curso y de pagos ' +
        'rechazados. Solo escucha eventos (media.ready, payment.failed, playback.completed); ' +
        'usa Redis para deduplicar y guardar el historial.',
    )
    .setVersion('1.0.0')
    .addTag('notifications')
    .addTag('health')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  // 3007: del 3001 al 3006 ya los usan los demás servicios de MediaStream.
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3007;
  await app.listen(port);
  Logger.log(`Notification-Service escuchando en el puerto ${port}`, 'Bootstrap');
  Logger.log('Documentación Swagger disponible en /docs', 'Bootstrap');
}

bootstrap();
