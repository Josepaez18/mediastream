import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { ProfilesModule } from '../profiles/profiles.module';
import { AdminSeedService } from './admin-seed.service';

@Module({
  imports: [JwtModule.register({}), ProfilesModule],
  providers: [AuthService, AdminSeedService],
  exports: [AuthService],
  controllers: [AuthController],
})
export class AuthModule {}
