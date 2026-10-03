import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cors from 'cors';
import { AppModule } from './app.module';
import { requestLogger } from './common/request-logger.middleware';
import { corsOptions } from './cors';
import { createGateway } from './proxy/gateway.middleware';
import { resolveTarget, ROUTES } from './proxy/routes';

function jwtSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_ACCESS_SECRET es obligatorio en producción (el mismo que usa User-Service).');
  }
  return 'dev-access-secret';
}

async function bootstrap() {
  // bodyParser: false → el Gateway no lee los cuerpos, los reenvía como llegan.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // Detrás del balanceador de Render: la IP real del cliente viene en
  // X-Forwarded-For (la usa el rate limiting).
  app.set('trust proxy', true);

  app.use(requestLogger);
  app.use(cors(corsOptions()));
  app.use(
    createGateway({
      jwtSecret: jwtSecret(),
      proxyTimeoutMs: parseInt(process.env.PROXY_TIMEOUT_MS ?? '15000', 10),
    }),
  );
  app.enableShutdownHooks();

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
  await app.listen(port);
  Logger.log(`API Gateway escuchando en el puerto ${port}`, 'Bootstrap');
  for (const route of ROUTES) {
    Logger.log(`${route.prefix}/* → ${resolveTarget(route)}`, 'Routes');
  }
}

bootstrap();
