import { AccountPlan, AccountRole } from '@prisma/client';

/**
 * Cuántos perfiles permite cada plan. El administrador siempre tiene el
 * máximo. (Los precios y el cobro viven en Billing-Service; aquí solo lo que
 * User necesita para aplicar el plan.)
 */
export const PROFILE_LIMITS: Record<AccountPlan, number> = {
  GRATIS: 1,
  BASICO: 2,
  ESTANDAR: 4,
  PREMIUM: 5,
};

export function profileLimit(plan: AccountPlan, role: AccountRole): number {
  return role === AccountRole.ADMIN ? PROFILE_LIMITS.PREMIUM : PROFILE_LIMITS[plan];
}

export function isPlan(value: unknown): value is AccountPlan {
  return typeof value === 'string' && value in PROFILE_LIMITS;
}
