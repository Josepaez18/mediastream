import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Guard mínimo de validación del AccessToken.
 * En producción real, esta validación ya la hace el API Gateway (sección 5 del
 * documento) y User-Service solo confiaría en las cabeceras inyectadas por él.
 * Se incluye aquí para poder probar el microservicio de forma aislada.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Falta el AccessToken (Bearer token).');
    }
    const token = authHeader.slice('Bearer '.length);
    try {
      const payload = this.jwtService.verify(token, {
        secret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
      });
      request.user = payload; // { sub: accountId, email }
      return true;
    } catch {
      throw new UnauthorizedException('AccessToken inválido o expirado.');
    }
  }
}
