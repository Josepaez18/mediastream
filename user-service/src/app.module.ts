import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConsoleConfigController } from './console-config.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProfilesModule } from './profiles/profiles.module';
import { BillingEventsModule } from './billing-events/billing-events.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ProfilesModule,
    BillingEventsModule,
  ],
  controllers: [HealthController, ConsoleConfigController],
})
export class AppModule {}
