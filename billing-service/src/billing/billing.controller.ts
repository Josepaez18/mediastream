import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { IsIn, IsNotEmpty, IsString, Matches } from 'class-validator';
import { Plan } from '@prisma/client';
import { PaypalCheckoutService } from './paypal-checkout.service';
import { BillingService } from './billing.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { WebhookDto } from './dto/webhook.dto';

export class CancelDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+$/, { message: 'accountId debe ser el ID numérico de la cuenta en User-Service.' })
  accountId: string;
}

/**
 * Detrás del API Gateway, cada petición trae la cuenta de la sesión
 * (x-account-id) y su rol (x-account-role). Una persona solo puede operar
 * sobre su propia cuenta; el administrador, sobre cualquiera. Sin esas
 * cabeceras (llamada directa al servicio, p. ej. en desarrollo) no se aplica.
 */
export function assertOwnAccount(req: Request, accountId: string) {
  const sessionAccount = req.headers['x-account-id'];
  if (!sessionAccount || req.headers['x-account-role'] === 'ADMIN') return;
  if (sessionAccount !== accountId) {
    throw new ForbiddenException('Solo puedes gestionar la suscripción de tu propia cuenta.');
  }
}

export class PaypalOrderDto extends CancelDto {
  @IsIn(Object.values(Plan))
  plan: Plan;
}

function assertAdmin(req: Request) {
  if (req.headers['x-account-id'] && req.headers['x-account-role'] !== 'ADMIN') {
    throw new ForbiddenException('Requiere rol de administrador.');
  }
}

@ApiTags('billing')
@Controller('api/billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly paypalCheckout: PaypalCheckoutService,
  ) {}

  // --- PayPal Checkout (sandbox) ---------------------------------------
  @Get('paypal/config')
  @ApiOperation({ summary: 'Si PayPal está habilitado y su Client ID (público) para cargar los botones.' })
  paypalConfig() {
    return this.paypalCheckout.config();
  }

  @Post('paypal/orders')
  @ApiOperation({ summary: 'Crea la orden de PayPal por el precio del plan (o la diferencia si cambia de plan).' })
  createPaypalOrder(@Body() dto: PaypalOrderDto, @Req() req: Request) {
    assertOwnAccount(req, dto.accountId);
    return this.paypalCheckout.createOrder(dto.accountId, dto.plan);
  }

  @Post('paypal/orders/:orderId/capture')
  @ApiOperation({ summary: 'Captura la orden aprobada en PayPal y activa el plan.' })
  async capturePaypalOrder(
    @Param('orderId') orderId: string,
    @Body() dto: CancelDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertOwnAccount(req, dto.accountId);
    if (!/^[A-Z0-9-]{5,40}$/i.test(orderId)) throw new ForbiddenException('Id de orden inválido.');
    const result = await this.paypalCheckout.capture(orderId, dto.accountId);
    res.status(result.httpStatus);
    return result.body;
  }

  @Post('subscribe')
  @ApiOperation({ summary: 'Crea una suscripción nueva y procesa el primer cobro.' })
  async subscribe(@Body() dto: SubscribeDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertOwnAccount(req, dto.accountId);
    const result = await this.billingService.subscribe(dto);
    res.status(result.httpStatus);
    return result.body;
  }

  @Put('plan')
  @ApiOperation({ summary: 'Cambia el plan de una suscripción activa y cobra la diferencia.' })
  async changePlan(@Body() dto: ChangePlanDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    assertOwnAccount(req, dto.accountId);
    const result = await this.billingService.changePlan(dto);
    res.status(result.httpStatus);
    return result.body;
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancela la suscripción vigente; la cuenta vuelve al plan GRATIS.' })
  cancel(@Body() dto: CancelDto, @Req() req: Request) {
    assertOwnAccount(req, dto.accountId);
    return this.billingService.cancel(dto.accountId);
  }

  @Get('history/:accountId')
  @ApiOperation({ summary: 'Historial de suscripciones y pagos de una cuenta.' })
  history(@Param('accountId') accountId: string, @Req() req: Request) {
    assertOwnAccount(req, accountId);
    return this.billingService.history(accountId);
  }

  @Get('admin/overview')
  @ApiOperation({ summary: 'Todas las suscripciones y totales de ingresos (administración).' })
  adminOverview(@Req() req: Request) {
    assertAdmin(req);
    return this.billingService.adminOverview();
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
