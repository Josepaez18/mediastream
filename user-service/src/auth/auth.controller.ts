import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const REFRESH_COOKIE_NAME = 'refresh_token';
const isProd = process.env.NODE_ENV === 'production';

@ApiTags('users')
@Controller('api/users')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Registra una nueva cuenta junto con su primer perfil.' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Crea AccessToken y RefreshToken. El AccessToken se devuelve en el body; ' +
      'el RefreshToken se entrega en una cookie httpOnly.',
  })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken, accountStatus } = await this.authService.login(dto);

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/api/users/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
    });

    return { accessToken, accountStatus };
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Verifica el RefreshToken de la cookie httpOnly y, si es válido, emite un nuevo AccessToken.',
  })
  async refresh(@Req() req: Request) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    return this.authService.refresh(refreshToken);
  }
}
