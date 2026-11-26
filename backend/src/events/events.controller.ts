import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { ListEventsDto } from './dto/list-events.dto';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  list(@Query() query: ListEventsDto) {
    return this.eventsService.list(query);
  }

  @Get(':eventId')
  findOne(@Param('eventId') eventId: string) {
    return this.eventsService.findOne(eventId);
  }

  @Post(':eventId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retry(@Param('eventId') eventId: string) {
    return this.eventsService.retry(eventId);
  }
}
