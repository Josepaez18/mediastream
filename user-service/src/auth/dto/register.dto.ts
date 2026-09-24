import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'usuario@correo.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'clave-segura-123', minLength: 8 })
  @MinLength(8)
  password: string;

  @ApiProperty({
    example: 'Papá',
    description: 'Nombre del primer perfil que se crea junto con la cuenta.',
  })
  @IsString()
  @MinLength(1)
  profileName: string;

  @ApiProperty({
    example: false,
    required: false,
    description: 'Si el primer perfil es infantil (aplica control parental).',
  })
  @IsOptional()
  isKids?: boolean;
}
