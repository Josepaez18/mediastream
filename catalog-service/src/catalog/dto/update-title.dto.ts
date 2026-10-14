import { ApiPropertyOptional } from '@nestjs/swagger';
import { TitleStatus } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { YOUTUBE_URL } from './create-title.dto';

// Uso administrativo: PATCH /api/catalog/titles/{id}. Todo es opcional;
// solo se cambia lo que se envía.
export class UpdateTitleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  synopsis?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ageRating?: string;

  @ApiPropertyOptional({ description: 'Visible con el plan GRATIS' })
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({ description: 'URL de la imagen; cadena vacía para quitarla' })
  @IsOptional()
  @IsString()
  posterUrl?: string;

  @ApiPropertyOptional({ description: 'Tráiler en YouTube; cadena vacía para quitarlo' })
  @IsOptional()
  @IsString()
  @Matches(YOUTUBE_URL, { message: 'trailerUrl debe ser un enlace de YouTube (o vacío para quitarlo).' })
  trailerUrl?: string;

  @ApiPropertyOptional({ enum: TitleStatus, description: 'AVAILABLE publica el título; UNAVAILABLE lo retira' })
  @IsOptional()
  @IsEnum(TitleStatus)
  status?: TitleStatus;

  @ApiPropertyOptional({
    example: ['CO', 'MX'],
    description: 'Reemplaza las regiones con licencia (disponibles desde ahora, sin fecha de fin)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  regions?: string[];
}
