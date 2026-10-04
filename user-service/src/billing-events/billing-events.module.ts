import { Module } from '@nestjs/common';
import { PaymentFailedController } from './payment-failed.controller';
import { PaymentDebugController } from './payment-debug.controller';
import { PaymentRestrictionService } from './payment-restriction.service';
import { SubscriptionEventsController } from './subscription-events.controller';

@Module({
  controllers: [PaymentFailedController, SubscriptionEventsController, PaymentDebugController],
  providers: [PaymentRestrictionService],
})
export class BillingEventsModule {}
