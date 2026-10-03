import { Module } from '@nestjs/common';
import { CatalogClient } from '../catalog/catalog.client';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsStore } from './notifications.store';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsStore, CatalogClient],
  exports: [NotificationsService],
})
export class NotificationsModule {}
