import { IsBooleanString, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

// GET /api/catalog/titles?region=CO
// El perfil activo (para aplicar control parental) llega como cabecera
// interna inyectada por el API Gateway (x-profile-is-kids), tal como se
// describe en la sección "Diseño de API Gateway" del documento.
export class ListTitlesQueryDto {
  @ApiPropertyOptional({ example: 'CO', description: 'Código de región/país' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'Drama' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    example: 'true',
    description: 'Si es "true", solo devuelve títulos aptos para perfiles infantiles (G, PG)',
  })
  @IsOptional()
  @IsBooleanString()
  isKids?: string;
}
