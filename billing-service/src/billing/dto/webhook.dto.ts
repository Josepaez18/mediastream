import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, Matches } from 'class-validator';

export enum WebhookEventType {
  PAYMENT_SUCCEEDED = 'payment_succeeded',
  PAYMENT_FAILED = 'payment_failed',
}

// Representa la notificación que la pasarela de pago enviaría de vuelta
// (webhook) cuando el resultado de un cobro se conoce después de la llamada
// original, por ejemplo un cobro recurrente de renovación. Es el mecanismo
// descrito en la sección 4.1 del documento para POST /api/billing/webhook.
export class WebhookDto {
  @ApiProperty({ example: '1', description: 'ID de la suscripción afectada.' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, { message: 'subscriptionId debe ser numérico.' })
  subscriptionId: string;

  @ApiProperty({ enum: WebhookEventType, example: WebhookEventType.PAYMENT_FAILED })
  @IsEnum(WebhookEventType)
  eventType: WebhookEventType;
}
