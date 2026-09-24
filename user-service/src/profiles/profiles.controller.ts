import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProfilesService } from './profiles.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

@ApiTags('users')
@Controller('api/users')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  // GET /api/users/profiles/{account_id}
  @Get('profiles/:account_id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lista los perfiles asociados a una cuenta.' })
  @UseGuards(JwtAuthGuard)
  async listProfiles(@Param('account_id') accountId: string, @Req() req: any) {
    // El AccessToken solo permite consultar los perfiles de la propia cuenta.
    if (req.user.sub !== accountId) {
      throw new ForbiddenException('No puede consultar perfiles de otra cuenta.');
    }
    const profiles = await this.profilesService.listByAccount(BigInt(accountId));
    return profiles.map((p) => ({
      id: p.id.toString(),
      accountId: p.accountId.toString(),
      name: p.name,
      isKids: p.isKids,
      createdAt: p.createdAt,
    }));
  }
}
