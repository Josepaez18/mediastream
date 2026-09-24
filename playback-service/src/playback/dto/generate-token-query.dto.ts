import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GenerateTokenQueryDto {
  @ApiProperty({ description: 'Perfil que solicita la reproducción', example: 'profile-42' })
  @IsString()
  @IsNotEmpty()
  profileId: string;

  @ApiProperty({
    description: 'Región del usuario, usada para validar la licencia del título',
    example: 'CO',
  })
  @IsString()
  @IsNotEmpty()
  region: string;

  @ApiPropertyOptional({ description: 'Dispositivo desde el que se reproduce' })
  @IsOptional()
  @IsString()
  deviceId?: string;
}
