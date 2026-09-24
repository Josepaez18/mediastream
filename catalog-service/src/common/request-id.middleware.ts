import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Propaga (o genera) el request-id inyectado por el API Gateway, tal como
// describe la sección 5 y 9 del documento de arquitectura, para poder
// rastrear una solicitud a través de los logs de varios servicios.
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use = (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || uuidv4();
    (req as any).requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const start = Date.now();
    res.on('finish', () => {
      const logLine = {
        level: 'info',
        timestamp: new Date().toISOString(),
        service: 'catalog-service',
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        latencyMs: Date.now() - start,
      };
      this.logger.log(JSON.stringify(logLine));
    });

    next();
  };
}
