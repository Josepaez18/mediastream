import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { AppModule } from './app.module';
import { allowedCorsOrigins } from './public-urls';

// Los IDs (Subscription/Payment) son BigInt, igual que en User-Service.
// Express/JSON no serializa BigInt de forma nativa, así que se define cómo
// convertirlo a string al responder por HTTP.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Sirve el frontend estático (public/index.html) en la raíz del servicio,
  // igual que el resto de microservicios, para que todas las consolas web
  // luzcan consistentes dentro de MediaStream.
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // CORS, con el mismo criterio que User, Catalog y Playback: permite que un
  // frontend servido desde otro origen (una app unificada, o el API Gateway)
  // llame a esta API. La consola propia no lo necesita (mismo origen).
  // "*" en CORS_ORIGINS significa "cualquier origen" y hay que pasarlo como
  // string: dentro de un array, el paquete cors compara "*" literalmente
  // contra el origen y no deja pasar ninguno.
  // Sin CORS_ORIGINS, se permiten solo las URLs públicas de MediaStream
  // (PUBLIC_*_URL, en Render); sin ninguna de las dos, "*" (desarrollo local).
  app.enableCors({ origin: allowedCorsOrigins() });

  // --- Comunicación síncrona (REST) ---
  const config = new DocumentBuilder()
    .setTitle('Billing Service - MediaStream')
    .setDescription(
      'Microservicio de Facturación: suscripciones, cambios de plan, historial y notificaciones de pago.',
    )
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // Nota: a diferencia de User-Service, Billing-Service no conecta un
  // microservicio RabbitMQ en modo "consumidor" (no usa @EventPattern):
  // solo PUBLICA el evento payment.failed a través de PaymentEventsService.
  // Por eso aquí no hace falta app.connectMicroservice(...).

  // 3006: del 3001 al 3005 ya los usan User, Catalog, Playback, Media y
  // Recommendation dentro de MediaStream.
  const port = process.env.PORT || 3006;
  await app.listen(port);
  console.log(`Billing Service escuchando en http://localhost:${port}`);
  console.log(`Consola web disponible en http://localhost:${port}/`);
  console.log(`Documentación Swagger en http://localhost:${port}/docs`);
}
bootstrap();
