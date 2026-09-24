import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

describe('CircuitBreaker (sección 4.7)', () => {
  let now = 0;
  const clock = () => now;
  const fail = () => Promise.reject(new Error('Catalog caído'));
  const ok = () => Promise.resolve('ok');

  const newBreaker = () =>
    new CircuitBreaker({ failureThreshold: 3, openMs: 30000, now: clock });

  beforeEach(() => {
    now = 0;
  });

  it('empieza cerrado y deja pasar las llamadas', async () => {
    const cb = newBreaker();
    await expect(cb.execute(ok)).resolves.toBe('ok');
    expect(cb.currentState).toBe('CLOSED');
  });

  it('se abre tras 3 fallos seguidos y bloquea sin llamar', async () => {
    const cb = newBreaker();
    for (let i = 0; i < 3; i++) await expect(cb.execute(fail)).rejects.toThrow('Catalog caído');
    expect(cb.currentState).toBe('OPEN');

    const fn = jest.fn(ok);
    await expect(cb.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('un éxito reinicia el conteo de fallos', async () => {
    const cb = newBreaker();
    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();
    await cb.execute(ok);
    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.currentState).toBe('CLOSED');
    expect(cb.failures).toBe(1);
  });

  it('pasado el tiempo deja una prueba (HALF_OPEN) y se cierra si responde', async () => {
    const cb = newBreaker();
    for (let i = 0; i < 3; i++) await expect(cb.execute(fail)).rejects.toThrow();
    now = 30000;
    expect(cb.currentState).toBe('HALF_OPEN');
    await expect(cb.execute(ok)).resolves.toBe('ok');
    expect(cb.currentState).toBe('CLOSED');
  });

  it('si la prueba falla, vuelve a abrirse por otros 30 s', async () => {
    const cb = newBreaker();
    for (let i = 0; i < 3; i++) await expect(cb.execute(fail)).rejects.toThrow();
    now = 30000;
    await expect(cb.execute(fail)).rejects.toThrow('Catalog caído');
    expect(cb.currentState).toBe('OPEN');
    now = 45000;
    await expect(cb.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('los errores que no son caídas (p. ej. 404) no abren el circuito', async () => {
    const cb = newBreaker();
    const notFound = () => Promise.reject(Object.assign(new Error('404'), { status: 404 }));
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(notFound, (e: any) => e.status >= 500)).rejects.toThrow('404');
    }
    expect(cb.currentState).toBe('CLOSED');
  });
});
