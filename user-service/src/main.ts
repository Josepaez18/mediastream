import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { join } from 'path';
import { AppModule } from './app.module';
import { allowedCorsOrigins } from './public-urls';

// Los IDs de Account/Profile son BigInt (columnas "bigint" del diagrama ER).
// Express/JSON no serializa BigInt de forma nativa, así que se define cómo
// convertirlo a string al responder por HTTP.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Sirve el frontend estático (public/index.html) en la raíz del servicio,
  // igual que en Catalog-Service, para que ambas consolas web luzcan
  // consistentes dentro de MediaStream.
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // CORS, con el mismo criterio que Catalog y Playback: permite que un
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
    .setTitle('User Service - MediaStream')
    .setDescription(
      'Microservicio de Usuarios y Suscripciones: registro, login, refresh y perfiles.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // --- Comunicación asíncrona (RabbitMQ) ---
  // Se usa RabbitMQ (y no Redis Pub/Sub) porque payment.failed es un evento que
  // "no puede perderse" (sección 4.2 del documento): debe persistir hasta que
  // User-Service confirme su procesamiento y reintentarse ante fallo.
  const rmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [rmqUrl],
      queue: 'user_service.payment_failed',
      queueOptions: { durable: true },
      noAck: false,
    },
  });

  // Primero la API HTTP: así el servicio responde (y pasa su health check)
  // aunque RabbitMQ no esté disponible o su URL esté mal. El consumidor de
  // payment.failed se conecta después y reintenta solo; mientras tanto los
  // eventos esperan en la cola.
  const port = process.env.PORT || 3001;
  await app.listen(port);
  app
    .startAllMicroservices()
    .then(() => console.log('Consumidor de payment.failed conectado a RabbitMQ'))
    .catch((err) => console.error(`No se pudo iniciar el consumidor de RabbitMQ: ${err}`));
  console.log(`User Service escuchando en http://localhost:${port}`);
  console.log(`Consola web disponible en http://localhost:${port}/`);
  console.log(`Documentación Swagger en http://localhost:${port}/docs`);
}
bootstrap();
