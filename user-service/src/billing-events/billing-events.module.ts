import { Module } from '@nestjs/common';
import { PaymentFailedController } from './payment-failed.controller';
import { PaymentDebugController } from './payment-debug.controller';
import { PaymentRestrictionService } from './payment-restriction.service';

@Module({
  controllers: [PaymentFailedController, PaymentDebugController],
  providers: [PaymentRestrictionService],
})
export class BillingEventsModule {}
