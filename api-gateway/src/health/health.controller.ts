import { Controller, Get } from '@nestjs/common';
import { resolveTarget, ROUTES } from '../proxy/routes';

const CHECK_TIMEOUT_MS = 3000;

@Controller()
export class HealthController {
  // Descripción del Gateway: qué prefijo va a qué servicio.
  @Get()
  info() {
    return {
      service: 'api-gateway',
      routes: ROUTES.map((r) => ({ prefix: `${r.prefix}/*`, service: `${r.service}-service`, target: resolveTarget(r) })),
    };
  }

  // El proceso está vivo.
  @Get('health')
  health() {
    return { status: 'ok', service: 'api-gateway' };
  }

  // El Gateway no tiene estado propio: si el proceso responde, puede atender
  // tráfico. Que un servicio de destino esté caído no lo saca de rotación
  // (las demás rutas siguen funcionando); eso se ve en /health/services.
  @Get('health/ready')
  ready() {
    return { status: 'ready', service: 'api-gateway' };
  }

  // Estado de cada microservicio detrás del Gateway (su /health/ready).
  @Get('health/services')
  async services() {
    const checks = await Promise.all(
      ROUTES.map(async (route) => {
        const target = resolveTarget(route);
        const start = Date.now();
        try {
          const res = await fetch(`${target}/health/ready`, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
          return { service: route.service, ok: res.ok, status: res.status, latencyMs: Date.now() - start };
        } catch {
          return { service: route.service, ok: false, status: null, latencyMs: Date.now() - start };
        }
      }),
    );
    return { status: checks.every((c) => c.ok) ? 'ok' : 'degraded', services: checks };
  }
}
