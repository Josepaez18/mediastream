import { Plan } from '@prisma/client';

/** Moneda en la que se muestran y registran los precios de MediaStream. */
export const CURRENCY = 'COP';

// Precios de los planes, en pesos colombianos (precios de prueba, ascendentes).
// Con ellos se calcula el cobro con tarjeta simulada, el prorrateo al cambiar
// de plan y los ingresos del panel de administración.
export const PLAN_PRICES: Record<Plan, number> = {
  BASICO: 0.1,
  ESTANDAR: 0.2,
  PREMIUM: 0.3,
};

// PayPal no opera en pesos colombianos y su cobro mínimo es 0,01 USD, así que
// la orden de PayPal se crea en dólares con estos montos (también
// ascendentes). El pago se registra con el precio del plan en COP.
export const PAYPAL_USD_PRICES: Record<Plan, number> = {
  BASICO: 0.01,
  ESTANDAR: 0.02,
  PREMIUM: 0.03,
};

const round2 = (n: number) => Number(n.toFixed(2));

/** Lo que se cobra al cambiar de plan: la diferencia, o el precio completo si no hay diferencia. */
export function planChangeAmount(prices: Record<Plan, number>, from: Plan, to: Plan): number {
  return round2(Math.abs(prices[to] - prices[from])) || prices[to];
}
