/**
 * Qué rutas pueden pasar sin AccessToken. Todo lo demás exige uno válido
 * (sección 5: "el Gateway valida la sesión antes de dejar pasar la petición
 * a cualquier microservicio protegido").
 *
 *   · Registro, inicio de sesión y refresh: todavía no hay token (el refresh
 *     usa su propia cookie httpOnly, que solo valida User-Service).
 *   · Lectura del catálogo: se puede explorar sin haber iniciado sesión.
 *   · Webhook de Stripe: lo llama la pasarela, no un usuario; Billing valida
 *     la firma del aviso.
 */
const PUBLIC_RULES: { methods: string[]; pattern: RegExp }[] = [
  { methods: ['POST'], pattern: /^\/api\/users\/(register|login|refresh)\/?$/ },
  { methods: ['GET', 'HEAD'], pattern: /^\/api\/catalog(\/.*)?$/ },
  { methods: ['POST'], pattern: /^\/api\/billing\/webhook\/?$/ },
];

export function isPublicRoute(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (m === 'OPTIONS') return true; // preflight de CORS
  return PUBLIC_RULES.some((rule) => rule.methods.includes(m) && rule.pattern.test(path));
}

/**
 * Rutas de administración: solo el rol ADMIN (sección 5: el Gateway valida la
 * sesión antes de dejar pasar la petición). Cada servicio vuelve a comprobar
 * el rol por su cuenta; esta es la primera barrera.
 *
 *   · Cuentas, suscripciones y títulos: /api/{users,billing,catalog}/admin/*
 *   · Escrituras en el catálogo (crear, editar, borrar títulos)
 *   · Subida y transcodificación de vídeos (Media-Processing)
 *   · Panel de KPIs y ETL (Analytics)
 */
export function isAdminRoute(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (m === 'OPTIONS') return false;
  if (/^\/api\/(users|billing|catalog)\/admin(\/|$)/.test(path)) return true;
  if (/^\/api\/catalog(\/|$)/.test(path) && m !== 'GET' && m !== 'HEAD') return true;
  return /^\/api\/(media|analytics)(\/|$)/.test(path);
}
