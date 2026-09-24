import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TitleType } from '@prisma/client';

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
}
