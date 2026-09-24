import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConsoleConfigController } from './console-config.controller';
import { PrismaModule } from './prisma/prisma.module';
import { BillingModule } from './billing/billing.module';
import { HealthController } from './health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, BillingModule],
  controllers: [HealthController, ConsoleConfigController],
})
export class AppModule {}
