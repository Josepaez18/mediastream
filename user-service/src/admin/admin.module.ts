import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminGuard } from '../common/admin.guard';
import { AdminController } from './admin.controller';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AdminController],
  providers: [AdminGuard],
})
export class AdminModule {}
