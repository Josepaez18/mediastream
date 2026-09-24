import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [JwtModule.register({}), ProfilesModule],
  providers: [AuthService],
  controllers: [AuthController],
})
export class AuthModule {}
