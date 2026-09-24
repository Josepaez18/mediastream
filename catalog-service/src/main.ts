import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import { AppModule } from './app.module';
import { allowedCorsOrigins } from './public-urls';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  // Sirve el frontend estático (public/index.html) en la raíz del servicio.
  app.useStaticAssets(join(__dirname, '..', 'public'));

  app.use(new RequestIdMiddleware().use);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  // "*" en CORS_ORIGINS significa "cualquier origen" y hay que pasarlo como
  // string: dentro de un array, el paquete cors compara "*" literalmente
  // contra el origen y no deja pasar ninguno.
  // Sin CORS_ORIGINS, se permiten solo las URLs públicas de MediaStream
  // (PUBLIC_*_URL, en Render); sin ninguna de las dos, "*" (desarrollo local).
  app.enableCors({ origin: allowedCorsOrigins() });

  // Documentación interactiva (Swagger UI), generada automáticamente a
  // partir de los decoradores del controller y los DTOs.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Catalog-Service')
    .setDescription(
      'MediaStream — Administra los títulos y categorías del catálogo de contenido.',
    )
    .setVersion('1.0.0')
    .addTag('catalog')
    .addTag('health')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3002;
  await app.listen(port);
  Logger.log(`Catalog-Service escuchando en el puerto ${port}`, 'Bootstrap');
  Logger.log(`Documentación Swagger disponible en /docs`, 'Bootstrap');
}

bootstrap();
