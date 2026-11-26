
import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
  } from 'typeorm';
  
  export enum WebhookEventStatus {
    PENDING = 'pending',
    PROCESSING = 'processing',
    RETRYING = 'retrying',
    COMPLETED = 'completed',
    FAILED = 'failed',
  }
  
  @Entity('webhook_events')
  @Index('idx_webhook_events_status', ['status'])
  @Index('idx_webhook_events_next_retry_at', ['nextRetryAt'])
  export class WebhookEvent {
    @PrimaryGeneratedColumn()
    id: number;
  
    @Column({
      name: 'event_id',
      type: 'varchar',
      length: 255,
      unique: true,
    })
    eventId: string;
  
    @Column({
      type: 'varchar',
      length: 255,
    })
    type: string;
  
    @Column({
      type: 'jsonb',
    })
    payload: Record<string, any>;
  
    @Column({
      type: 'varchar',
      length: 30,
      default: WebhookEventStatus.PENDING,
    })
    status: WebhookEventStatus;
  
    @Column({
      type: 'integer',
      default: 0,
    })
    attempts: number;
  
    @Column({
      name: 'max_attempts',
      type: 'integer',
      default: 5,
    })
    maxAttempts: number;
  
    @Column({
      name: 'next_retry_at',
      type: 'timestamptz',
      nullable: true,
    })
    nextRetryAt: Date | null;
  
    @Column({
      name: 'locked_by',
      type: 'varchar',
      length: 255,
      nullable: true,
    })
    lockedBy: string | null;
  
    @Column({
      name: 'lease_until',
      type: 'timestamptz',
      nullable: true,
    })
    leaseUntil: Date | null;
  
    @Column({
      name: 'lease_token',
      type: 'uuid',
      nullable: true,
    })
    leaseToken: string | null;
  
    @CreateDateColumn({
      name: 'created_at',
      type: 'timestamptz',
    })
    createdAt: Date;
  
    @UpdateDateColumn({
      name: 'updated_at',
      type: 'timestamptz',
    })
    updatedAt: Date;
  }
  