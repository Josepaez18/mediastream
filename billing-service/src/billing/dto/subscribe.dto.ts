import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, Matches } from 'class-validator';
import { Plan } from '@prisma/client';

export class SubscribeDto {
  @ApiProperty({
    example: '1',
    description: 'ID de la cuenta que se suscribe (creada previamente en User-Service).',
  })
  @IsString()
  @IsNotEmpty()
  // Es un bigint en User-Service: si no es numérico, 400 en vez de un 500 al
  // convertirlo con BigInt().
  @Matches(/^\d+$/, { message: 'accountId debe ser el ID numérico de la cuenta en User-Service.' })
  accountId: string;

  @ApiProperty({ enum: Plan, example: Plan.ESTANDAR })
  @IsIn(Object.values(Plan))
  plan: Plan;

  @ApiProperty({
    example: '4242424242424242',
    description:
      'Número de tarjeta (simulado, sin pasarela real). Ver README para las tarjetas de prueba.',
  })
  @IsString()
  @IsNotEmpty()
  cardNumber: string;
}
