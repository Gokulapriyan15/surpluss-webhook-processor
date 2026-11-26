
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { WebhookEvent } from '../events/entities/webhook-event.entity';
import { WebhookEventStatus } from '../events/entities/webhook-event.entity';

import { CreateWebhookDto } from './dto/create-webhook.dto';

@Injectable()
export class WebhooksService {
  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookRepository: Repository<WebhookEvent>,
    private readonly configService: ConfigService,
  ) {}

  /** Retry budget given to every new event (env: MAX_ATTEMPTS, default 5). */
  private get maxAttempts(): number {
    const value = Number(this.configService.get('MAX_ATTEMPTS') ?? 5);

    return Number.isInteger(value) && value >= 1 ? value : 5;
  }

  async receiveWebhook(dto: CreateWebhookDto) {
    // Preserve the original complete webhook payload.
    const payload: WebhookEvent['payload'] = {
      eventId: dto.eventId,
      type: dto.type,
      data: dto.data,
    };

    const result = await this.webhookRepository
      .createQueryBuilder()
      .insert()
      .into<WebhookEvent>(WebhookEvent)
      .values({
        eventId: dto.eventId,
        type: dto.type,
        payload,

        status: WebhookEventStatus.PENDING,
        attempts: 0,
        maxAttempts: this.maxAttempts,
      })
      .orIgnore()
      .returning(['id'])
      .execute();

    // `identifiers` is built from the submitted values and is populated even when
    // ON CONFLICT DO NOTHING skips the row. `raw` holds the actual RETURNING rows,
    // which are empty on conflict.
    const insertedRows = result.raw as Array<{ id: number }>;
    const isDuplicate = insertedRows.length === 0;

    return {
      success: true,
      message: 'Webhook accepted',
      eventId: dto.eventId,
      duplicate: isDuplicate,
    };
  }
}
