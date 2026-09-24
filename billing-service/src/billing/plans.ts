import { Plan } from '@prisma/client';

// Precios de referencia para la demo. El documento de arquitectura no
// especifica montos, así que se definen aquí para poder calcular el cobro
// simulado en /subscribe y /plan.
export const PLAN_PRICES: Record<Plan, number> = {
  BASICO: 7.99,
  ESTANDAR: 12.99,
  PREMIUM: 17.99,
};
