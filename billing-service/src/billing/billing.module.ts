import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripeModule } from '../stripe/stripe.module';
import { PaymentEventsModule } from '../events/payment-events.module';

@Module({
  imports: [StripeModule, PaymentEventsModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
