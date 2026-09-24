import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { PaymentRestrictionService } from './payment-restriction.service';

class SimulatePaymentFailedDto {
  @ApiProperty({ example: '1', description: 'ID de la cuenta a marcar con un pago fallido.' })
  @IsString()
  accountId: string;
}

/**
 * SOLO PARA DEMOSTRACIÓN: expone por HTTP la misma acción que dispara el
 * consumidor de RabbitMQ al recibir payment.failed. Sirve para mostrar el
 * flujo asíncrono desde la consola web sin necesitar una terminal aparte ni
 * que Billing-Service esté corriendo. En producción este endpoint no
 * existiría: el único camino real hacia la restricción de acceso es el
 * evento payment.failed publicado por Billing-Service a través de RabbitMQ.
 */
@ApiTags('debug')
@Controller('api/users/debug')
export class PaymentDebugController {
  constructor(private readonly paymentRestriction: PaymentRestrictionService) {}

  @Post('payment-failed')
  @ApiOperation({
    summary:
      '[Solo demo] Simula un evento payment.failed sin pasar por RabbitMQ, para la consola web.',
  })
  simulate(@Body() dto: SimulatePaymentFailedDto) {
    return this.paymentRestriction.registerFailedPayment(dto.accountId);
  }
}
