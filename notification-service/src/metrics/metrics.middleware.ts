import type { NextFunction, Request, Response } from 'express';
import { collectDefaultMetrics, Counter, Histogram, register } from 'prom-client';

/**
 * Métricas para Prometheus (sección 9, Observabilidad).
 *
 *   GET /metrics                    texto en el formato de Prometheus
 *   http_requests_total             peticiones atendidas, por method, route y status
 *   http_request_duration_seconds   histograma de tiempos de respuesta, mismas etiquetas
 *   process_* y nodejs_*            métricas por defecto del proceso (CPU, memoria, event loop)
 *
 * La disponibilidad (up) la calcula Prometheus en cada consulta a /metrics, y
 * la tasa de errores sale de las peticiones con status 5xx.
 *
 * Se registra en main.ts antes que cualquier otro middleware: así mide la
 * petición completa, y /metrics se responde aquí mismo, sin pasar por guards
 * (no exige JWT) ni por el resto de la aplicación.
 */
collectDefaultMetrics();

const LABELS = ['method', 'route', 'status'] as const;

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Peticiones HTTP atendidas',
  labelNames: LABELS,
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Tiempo de respuesta de las peticiones HTTP, en segundos',
  labelNames: LABELS,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/**
 * Ruta declarada en el controlador (p. ej. /api/notifications/:profileId) y
 * no la URL recibida: un id distinto en cada petición no crea una serie nueva
 * en Prometheus. Lo que no coincide con ninguna ruta (archivos estáticos,
 * 404) se agrupa en "other".
 */
export function routeLabel(req: Request): string {
  const path = req.route?.path;
  return typeof path === 'string' ? path : 'other';
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' && req.path === '/metrics') {
    register
      .metrics()
      .then((body) => {
        res.setHeader('Content-Type', register.contentType);
        res.end(body);
      })
      .catch(next);
    return;
  }

  const stopTimer = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const labels = { method: req.method, route: routeLabel(req), status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    stopTimer(labels);
  });
  next();
}
