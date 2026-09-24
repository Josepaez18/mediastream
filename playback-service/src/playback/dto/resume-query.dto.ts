import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumberString, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class ResumeQueryDto {
  @ApiPropertyOptional({
    description: 'Si se indica, devuelve solo el punto de continuación de ese título',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'titleId debe ser un id numérico' })
  titleId?: string;

  @ApiPropertyOptional({
    description: 'Incluir también el contenido ya terminado',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeCompleted?: boolean;
}
