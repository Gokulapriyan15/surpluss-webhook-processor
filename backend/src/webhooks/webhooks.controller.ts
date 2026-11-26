
import {
    Body,
    Controller,
    HttpCode,
    HttpStatus,
    Post,
  } from '@nestjs/common';
  
  import { CreateWebhookDto } from './dto/create-webhook.dto';
  import { WebhooksService } from './webhooks.service';
  
  @Controller('webhooks')
  export class WebhooksController {
    constructor(
      private readonly webhooksService: WebhooksService,
    ) {}
  
    @Post()
    @HttpCode(HttpStatus.ACCEPTED)
    async receiveWebhook(
      @Body() dto: CreateWebhookDto,
    ) {
      return this.webhooksService.receiveWebhook(dto);
    }
  }
  