
import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
  } from 'typeorm';
  
  @Entity('processed_orders')
  export class ProcessedOrder {
    @PrimaryGeneratedColumn()
    id: number;
  
    @Column({
      name: 'order_id',
      type: 'varchar',
      length: 255,
    })
    orderId: string;
  
    @Column({
      name: 'event_id',
      type: 'varchar',
      length: 255,
      unique: true,
    })
    eventId: string;
  
    @CreateDateColumn({
      name: 'processed_at',
      type: 'timestamptz',
    })
    processedAt: Date;
  }
  