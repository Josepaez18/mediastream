import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // GET /api/notifications/{profile_id} (sección 2 del documento)
  @Get(':profileId')
  @ApiOperation({
    summary: 'Historial de notificaciones de un perfil',
    description:
      'Incluye los avisos del perfil (series en curso), los estrenos para todos y, si se indica ' +
      'accountId, los avisos de la cuenta (pagos rechazados). Más recientes primero.',
  })
  @ApiQuery({ name: 'accountId', required: false })
  @ApiQuery({ name: 'limit', required: false, description: 'Máximo 100 (por defecto 50)' })
  history(
    @Param('profileId') profileId: string,
    @Query('accountId') accountId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = parseInt(limit ?? '50', 10);
    const safeLimit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
    return this.notifications.history(profileId, accountId || undefined, safeLimit);
  }
}
