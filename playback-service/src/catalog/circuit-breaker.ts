/**
 * Circuit breaker (sección 4.7 del documento).
 *
 * 1. CLOSED: las llamadas pasan normalmente. Si se acumulan
 *    `failureThreshold` fallos consecutivos, el circuito se abre.
 * 2. OPEN: las llamadas se bloquean de inmediato (no llegan a Catalog) durante
 *    `openMs` milisegundos.
 * 3. HALF_OPEN: pasado ese tiempo se deja pasar una solicitud de prueba. Si
 *    responde bien, el circuito se cierra; si falla, vuelve a abrirse.
 *
 * El estado vive en memoria de cada instancia: es suficiente para proteger a
 * Catalog de una avalancha de llamadas desde esa instancia de Playback.
 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitOpenError extends Error {
  constructor(readonly retryInMs: number) {
    super(
      `Circuito abierto: no se llama a Catalog-Service durante ${Math.ceil(retryInMs / 1000)} s más.`,
    );
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  openMs: number;
  now?: () => number;
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private trialInFlight = false;
  private readonly now: () => number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** Estado actual, tal como lo vería la próxima llamada. */
  get currentState(): CircuitState {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.opts.openMs) {
      return 'HALF_OPEN';
    }
    return this.state;
  }

  get failures(): number {
    return this.consecutiveFailures;
  }

  /**
   * Ejecuta `fn` protegida por el circuito. `isFailure` decide qué errores
   * cuentan como falla del servicio remoto (un 404 o un 400 significan que
   * Catalog respondió, así que no abren el circuito).
   */
  async execute<T>(fn: () => Promise<T>, isFailure: (err: unknown) => boolean = () => true): Promise<T> {
    if (this.state === 'OPEN') {
      const elapsed = this.now() - this.openedAt;
      if (elapsed < this.opts.openMs) {
        throw new CircuitOpenError(this.opts.openMs - elapsed);
      }
      this.transition('HALF_OPEN');
    }

    let isTrial = false;
    if (this.state === 'HALF_OPEN') {
      // Solo una solicitud de prueba a la vez; las demás siguen bloqueadas.
      if (this.trialInFlight) throw new CircuitOpenError(0);
      this.trialInFlight = true;
      isTrial = true;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      if (isFailure(err)) this.recordFailure();
      else this.recordSuccess();
      throw err;
    } finally {
      if (isTrial) this.trialInFlight = false;
    }
  }

  private recordSuccess() {
    this.consecutiveFailures = 0;
    if (this.state !== 'CLOSED') this.transition('CLOSED');
  }

  private recordFailure() {
    this.consecutiveFailures += 1;
    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.opts.failureThreshold) {
      this.openedAt = this.now();
      if (this.state !== 'OPEN') this.transition('OPEN');
    }
  }

  private transition(to: CircuitState) {
    const from = this.state;
    this.state = to;
    this.opts.onStateChange?.(from, to);
  }
}
