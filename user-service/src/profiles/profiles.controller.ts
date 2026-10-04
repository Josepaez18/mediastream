import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ProfilesService } from './profiles.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

export class CreateProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  name: string;

  @IsOptional()
  @IsBoolean()
  isKids?: boolean;
}

const serialize = (p: { id: bigint; accountId: bigint; name: string; isKids: boolean; createdAt: Date }) => ({
  id: p.id.toString(),
  accountId: p.accountId.toString(),
  name: p.name,
  isKids: p.isKids,
  createdAt: p.createdAt,
});

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/users')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  // GET /api/users/profiles/{account_id}
  @Get('profiles/:account_id')
  @ApiOperation({ summary: 'Lista los perfiles asociados a una cuenta.' })
  async listProfiles(@Param('account_id') accountId: string, @Req() req: any) {
    // El AccessToken solo permite consultar los perfiles de la propia cuenta.
    if (req.user.sub !== accountId && req.user.role !== 'ADMIN') {
      throw new ForbiddenException('No puede consultar perfiles de otra cuenta.');
    }
    const profiles = await this.profilesService.listByAccount(BigInt(accountId));
    return profiles.map(serialize);
  }

  // POST /api/users/profiles: nuevo perfil en la propia cuenta.
  @Post('profiles')
  @ApiOperation({ summary: 'Crea un perfil en la cuenta de la sesión (límite según el plan).' })
  async createProfile(@Body() dto: CreateProfileDto, @Req() req: any) {
    const profile = await this.profilesService.create(BigInt(req.user.sub), dto.name.trim(), Boolean(dto.isKids));
    return serialize(profile);
  }

  // DELETE /api/users/profiles/{id}
  @Delete('profiles/:id')
  @ApiOperation({ summary: 'Borra un perfil de la cuenta de la sesión.' })
  removeProfile(@Param('id') id: string, @Req() req: any) {
    if (!/^\d+$/.test(id)) throw new ForbiddenException('Id de perfil inválido.');
    return this.profilesService.remove(BigInt(req.user.sub), BigInt(id));
  }
}
