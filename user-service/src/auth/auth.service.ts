import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../profiles/profiles.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Account, AccountStatus } from '@prisma/client';
import { profileLimit } from '../common/plans';

const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_TTL || '15m';
const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_TTL || '7d';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesService: ProfilesService,
    private readonly jwtService: JwtService,
  ) {}

  // POST /api/users/register
  // Registra una nueva cuenta junto con su primer perfil.
  async register(dto: RegisterDto) {
    const existing = await this.prisma.account.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Ya existe una cuenta con ese correo.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const account = await this.prisma.account.create({
      data: { email: dto.email, passwordHash },
    });

    const profile = await this.profilesService.createFirstProfile(
      account.id,
      dto.profileName,
      Boolean(dto.isKids),
    );

    return {
      account: {
        id: account.id.toString(),
        email: account.email,
        status: account.status,
        createdAt: account.createdAt,
      },
      profile: {
        id: profile.id.toString(),
        name: profile.name,
        isKids: profile.isKids,
      },
    };
  }

  // POST /api/users/login
  // Crea AccessToken + RefreshToken. Solo el AccessToken se devuelve en el
  // body; el RefreshToken se entrega como cookie httpOnly (lo hace el
  // controller, aquí solo se generan ambos tokens).
  async login(dto: LoginDto) {
    const account = await this.prisma.account.findUnique({
      where: { email: dto.email },
    });
    if (!account) {
      // Se distingue "no existe" de "contraseña incorrecta" para que el
      // frontend pueda llevar a la persona al registro. Revela si un correo
      // está registrado; se acepta en esta plataforma y el rate limiting del
      // Gateway (10 intentos por minuto) frena la enumeración masiva.
      throw new NotFoundException({
        message: 'No existe una cuenta con ese correo. Regístrate para empezar.',
        code: 'ACCOUNT_NOT_FOUND',
      });
    }

    const passwordOk = await bcrypt.compare(dto.password, account.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    if (account.status === AccountStatus.SUSPENDIDA) {
      throw new ForbiddenException(
        'La cuenta está suspendida por pagos pendientes. Regularice su suscripción.',
      );
    }

    const accessToken = this.signAccessToken(account);
    const refreshToken = this.signRefreshToken(account.id.toString());

    return {
      accessToken,
      refreshToken,
      accountStatus: account.status, // el cliente puede mostrar el aviso si está MOROSA
      account: this.serializeAccount(account),
    };
  }

  // POST /api/users/refresh
  // Verifica el RefreshToken (viene de la cookie httpOnly) y emite un nuevo AccessToken.
  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) {
      throw new UnauthorizedException('No hay RefreshToken en la cookie.');
    }
    let payload: { sub: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
      });
    } catch {
      throw new UnauthorizedException('RefreshToken inválido o expirado.');
    }

    const account = await this.prisma.account.findUnique({
      where: { id: BigInt(payload.sub) },
    });
    if (!account || account.status === AccountStatus.SUSPENDIDA) {
      throw new UnauthorizedException('No se puede renovar el acceso.');
    }

    const accessToken = this.signAccessToken(account);
    return { accessToken };
  }

  /**
   * GET /api/users/me: datos de la cuenta y un AccessToken nuevo con el rol,
   * el plan y el estado ACTUALES. El frontend lo llama tras suscribirse
   * (el plan cambia por un evento de Billing) y periódicamente para renovar
   * la sesión sin depender de la cookie de refresh.
   */
  async me(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: BigInt(accountId) },
      include: { _count: { select: { profiles: true } } },
    });
    if (!account || account.status === AccountStatus.SUSPENDIDA) {
      throw new UnauthorizedException('La sesión ya no es válida.');
    }
    return {
      account: {
        ...this.serializeAccount(account),
        profiles: account._count.profiles,
        profileLimit: profileLimit(account.plan, account.role),
      },
      accessToken: this.signAccessToken(account),
    };
  }

  serializeAccount(account: Account) {
    return {
      id: account.id.toString(),
      email: account.email,
      role: account.role,
      plan: account.plan,
      status: account.status,
      createdAt: account.createdAt,
    };
  }

  // El AccessToken lleva rol, plan y estado: el API Gateway los valida y los
  // pasa a cada servicio (x-account-role, x-account-plan, x-account-status).
  private signAccessToken(account: Account): string {
    return this.jwtService.sign(
      {
        sub: account.id.toString(),
        email: account.email,
        role: account.role,
        plan: account.plan,
        status: account.status,
      },
      {
        secret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
        expiresIn: ACCESS_TOKEN_TTL,
      },
    );
  }

  private signRefreshToken(accountId: string): string {
    return this.jwtService.sign(
      { sub: accountId },
      {
        secret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
        expiresIn: REFRESH_TOKEN_TTL,
      },
    );
  }
}
