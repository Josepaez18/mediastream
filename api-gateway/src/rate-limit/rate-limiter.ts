export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Segundos hasta que se reinicia la ventana. */
  resetSeconds: number;
}

/**
 * Rate limiting de ventana fija, en memoria (sección 5 del documento).
 *
 * Simplificación: cada instancia del Gateway lleva su propia cuenta. Con una
 * sola instancia (como en Render gratis) es exacto; con varias, el límite
 * efectivo se multiplica por el número de instancias, y lo correcto sería
 * guardar los contadores en Redis.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(private readonly windowMs = 60_000) {}

  hit(key: string, limit: number, now = Date.now()): RateLimitResult {
    this.sweep(now);
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return {
      allowed: window.count <= limit,
      limit,
      remaining: Math.max(limit - window.count, 0),
      resetSeconds: Math.ceil((window.resetAt - now) / 1000),
    };
  }

  /** Olvida las ventanas vencidas, para que la memoria no crezca sin límite. */
  private sweep(now: number) {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

export interface RateLimitRule {
  name: string;
  limit: number;
}

const env = (name: string, fallback: number) => {
  const value = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * Límites por minuto: más permisivos en lectura del catálogo, más estrictos
 * en endpoints sensibles (login y cobros), como pide la sección 5.
 */
export function ruleFor(method: string, path: string): RateLimitRule {
  if (/^\/api\/users\/(login|register|refresh)/.test(path)) {
    return { name: 'sensitive', limit: env('RATE_LIMIT_SENSITIVE', 10) };
  }
  if (path.startsWith('/api/billing') && !path.startsWith('/api/billing/webhook')) {
    return { name: 'billing', limit: env('RATE_LIMIT_BILLING', 20) };
  }
  if (path.startsWith('/api/catalog') && method.toUpperCase() === 'GET') {
    return { name: 'read', limit: env('RATE_LIMIT_READ', 300) };
  }
  return { name: 'default', limit: env('RATE_LIMIT_DEFAULT', 120) };
}
