import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { BillingService } from './billing.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { WebhookDto } from './dto/webhook.dto';

@ApiTags('billing')
@Controller('api/billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('subscribe')
  @ApiOperation({ summary: 'Crea una suscripción nueva y procesa el primer cobro.' })
  async subscribe(@Body() dto: SubscribeDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.billingService.subscribe(dto);
    res.status(result.httpStatus);
    return result.body;
  }

  @Put('plan')
  @ApiOperation({ summary: 'Cambia el plan de una suscripción activa y cobra la diferencia.' })
  async changePlan(@Body() dto: ChangePlanDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.billingService.changePlan(dto);
    res.status(result.httpStatus);
    return result.body;
  }

  @Get('history/:accountId')
  @ApiOperation({ summary: 'Historial de suscripciones y pagos de una cuenta.' })
  history(@Param('accountId') accountId: string) {
    return this.billingService.history(accountId);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Notificación entrante de la pasarela de pago sobre un cobro recurrente.',
  })
  webhook(@Body() dto: WebhookDto) {
    return this.billingService.handleWebhook(dto);
  }
}
