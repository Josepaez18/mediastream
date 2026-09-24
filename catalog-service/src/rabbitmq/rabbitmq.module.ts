import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { MediaEventsConsumer } from './media-events.consumer';

@Module({
  imports: [CatalogModule],
  providers: [MediaEventsConsumer],
  exports: [MediaEventsConsumer],
})
export class RabbitmqModule {}
