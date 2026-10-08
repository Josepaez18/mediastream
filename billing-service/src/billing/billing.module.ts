import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripeModule } from '../stripe/stripe.module';
import { PaymentEventsModule } from '../events/payment-events.module';
import { PaypalModule } from '../paypal/paypal.module';
import { PaypalCheckoutService } from './paypal-checkout.service';

@Module({
  imports: [StripeModule, PaymentEventsModule, PaypalModule],
  controllers: [BillingController],
  providers: [BillingService, PaypalCheckoutService],
})
export class BillingModule {}
