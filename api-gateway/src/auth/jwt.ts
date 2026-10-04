import * as jwt from 'jsonwebtoken';

export interface AccessTokenClaims {
  accountId: string;
  email?: string;
  role?: string;
  plan?: string;
  status?: string;
}

export class InvalidTokenError extends Error {}

/**
 * Valida firma y expiración del AccessToken que emite User-Service (sección
 * 10): un JWT HS256 firmado con JWT_ACCESS_SECRET, con
 * { sub: accountId, email, role, plan, status }.
 * El Gateway lo valida solo, sin consultar a User-Service en cada petición.
 */
export function verifyAccessToken(authorization: string | undefined, secret: string): AccessTokenClaims {
  if (!authorization || !authorization.startsWith('Bearer ')) {
    throw new InvalidTokenError('Falta el AccessToken (cabecera Authorization: Bearer ...).');
  }
  try {
    const payload = jwt.verify(authorization.slice('Bearer '.length).trim(), secret, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;
    if (!payload.sub) throw new InvalidTokenError('El AccessToken no identifica una cuenta.');
    return {
      accountId: String(payload.sub),
      email: payload.email,
      role: payload.role,
      plan: payload.plan,
      status: payload.status,
    };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new InvalidTokenError('AccessToken expirado: renuévalo con POST /api/users/refresh.');
    }
    if (err instanceof InvalidTokenError) throw err;
    throw new InvalidTokenError('AccessToken inválido.');
  }
}
