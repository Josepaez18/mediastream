import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProgressDto {
  @ApiProperty({
    description: 'Id del perfil que está reproduciendo',
    example: 'profile-42',
  })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({ description: 'Id del título en el catálogo', example: '1' })
  @IsNumberString({}, { message: 'titleId debe ser un id numérico' })
  titleId: string;

  @ApiPropertyOptional({
    description: 'Id del episodio, solo cuando el título es una serie',
    example: '7',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'episodeId debe ser un id numérico' })
  episodeId?: string;

  @ApiProperty({ description: 'Posición exacta en segundos', example: 1830 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  positionSeconds: number;

  @ApiPropertyOptional({
    description:
      'Duración total del contenido en segundos, para calcular el porcentaje visto',
    example: 7200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationSeconds?: number;

  @ApiPropertyOptional({
    description: 'Identificador del dispositivo utilizado',
    example: 'smart-tv-samsung-01',
  })
  @IsOptional()
  @IsString()
  deviceId?: string;
}
