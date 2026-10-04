import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PlaybackService } from './playback.service';
import { CreateProgressDto } from './dto/create-progress.dto';
import { GenerateTokenQueryDto } from './dto/generate-token-query.dto';
import { ResumeQueryDto } from './dto/resume-query.dto';

@ApiTags('playback')
@Controller('api/playback')
export class PlaybackController {
  constructor(private readonly playbackService: PlaybackService) {}

  @Get('token/:titleId')
  @ApiOperation({
    summary:
      'Genera el token de acceso DRM de corta duración para iniciar la reproducción.',
  })
  @ApiParam({ name: 'titleId', description: 'Id del título en el catálogo' })
  generateToken(
    @Param('titleId') titleId: string,
    @Query() query: GenerateTokenQueryDto,
    @Req() req: Request,
  ) {
    const header = (name: string) => (req.headers[name] as string | undefined) || undefined;
    return this.playbackService.generateToken(titleId, query, {
      plan: header('x-account-plan'),
      role: header('x-account-role'),
      status: header('x-account-status'),
    });
  }

  @Post('progress')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Registra la posición actual de reproducción de un perfil.',
  })
  saveProgress(@Body() dto: CreateProgressDto) {
    return this.playbackService.saveProgress(dto);
  }

  @Get('resume/:profileId')
  @ApiOperation({
    summary:
      'Consulta los puntos de continuación de un perfil ("Seguir viendo").',
  })
  @ApiParam({ name: 'profileId', description: 'Id del perfil del usuario' })
  getResume(
    @Param('profileId') profileId: string,
    @Query() query: ResumeQueryDto,
  ) {
    if (query.titleId) {
      return this.playbackService.getResumeForTitle(profileId, query.titleId);
    }
    return this.playbackService.getResumePoints(
      profileId,
      query.includeCompleted ?? false,
    );
  }
}
