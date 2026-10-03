import type { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Logging del Gateway (secciones 5 y 9): asigna a cada solicitud un
 * request-id único, lo propaga como cabecera x-request-id hacia el
 * microservicio de destino (que lo incluye en sus propios logs) y registra
 * una línea JSON con método, ruta, código, latencia, cuenta y servicio.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();
  req.headers['x-request-id'] = requestId;
  res.setHeader('x-request-id', requestId);

  const start = Date.now();
  res.on('finish', () => {
    console.log(
      JSON.stringify({
        level: res.statusCode >= 500 ? 'error' : 'info',
        timestamp: new Date().toISOString(),
        service: 'api-gateway',
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        latencyMs: Date.now() - start,
        accountId: res.locals.accountId ?? null,
        upstream: res.locals.upstream ?? null,
      }),
    );
  });
  next();
}
