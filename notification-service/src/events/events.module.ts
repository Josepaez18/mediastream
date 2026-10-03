import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlaybackEventsSubscriber } from './playback-events.subscriber';
import { RabbitmqConsumer } from './rabbitmq.consumer';

@Module({
  imports: [NotificationsModule],
  providers: [RabbitmqConsumer, PlaybackEventsSubscriber],
  exports: [RabbitmqConsumer, PlaybackEventsSubscriber],
})
export class EventsModule {}
