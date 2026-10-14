import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TitleType } from '@prisma/client';

// youtube.com/watch?v=…, youtu.be/…, youtube.com/embed/… o /shorts/…
export const YOUTUBE_URL = /^$|^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|embed\/|shorts\/)|youtu\.be\/)[A-Za-z0-9_-]{11}/;

class AvailabilityInputDto {
  @ApiProperty({ example: 'CO', description: 'Código de región/país' })
  @IsString()
  @IsNotEmpty()
  region: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  availableFrom: string;

  @ApiPropertyOptional({ example: '2027-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  availableUntil?: string;
}

class EpisodeInputDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  episodeNumber: number;

  @ApiPropertyOptional({ example: 2700, description: 'Duración en segundos' })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;
}

class SeasonInputDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  seasonNumber: number;

  @ApiPropertyOptional({ type: [EpisodeInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EpisodeInputDto)
  episodes?: EpisodeInputDto[];
}

// Uso administrativo: POST /api/catalog/titles
export class CreateTitleDto {
  @ApiProperty({ example: 'Nueva Película', description: 'Nombre del título' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Una historia sobre...' })
  @IsOptional()
  @IsString()
  synopsis?: string;

  @ApiProperty({ enum: TitleType, example: TitleType.MOVIE })
  @IsEnum(TitleType)
  type: TitleType;

  @ApiPropertyOptional({ example: 'Acción' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 'PG-13' })
  @IsOptional()
  @IsString()
  ageRating?: string;

  @ApiPropertyOptional({ type: [SeasonInputDto], description: 'Solo aplica si type=SERIES' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeasonInputDto)
  seasons?: SeasonInputDto[];

  @ApiPropertyOptional({ type: [AvailabilityInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityInputDto)
  availabilities?: AvailabilityInputDto[];

  @ApiPropertyOptional({ example: false, description: 'Visible con el plan GRATIS' })
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({ example: 'https://ejemplo.com/poster.jpg', description: 'Imagen del título' })
  @IsOptional()
  @IsString()
  posterUrl?: string;

  @ApiPropertyOptional({ example: 'https://www.youtube.com/watch?v=RV9L7ui9Cn8', description: 'Tráiler en YouTube' })
  @IsOptional()
  @IsString()
  @Matches(YOUTUBE_URL, { message: 'trailerUrl debe ser un enlace de YouTube (o vacío para quitarlo).' })
  trailerUrl?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'Si es true, el título se crea como AVAILABLE de inmediato, sin esperar el evento media.ready. Por defecto queda PENDING.',
  })
  @IsOptional()
  @IsBoolean()
  publishImmediately?: boolean;
}
