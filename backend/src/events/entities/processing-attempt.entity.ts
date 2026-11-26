
import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
  } from 'typeorm';
  
  export enum AttemptResult {
    RUNNING = 'running',
    SUCCESS = 'success',
    FAILED = 'failed',
  }
  
  @Entity('processing_attempts')
  @Index(
    'uq_processing_attempt_event_number',
    ['eventId', 'attemptNumber'],
    { unique: true },
  )
  export class ProcessingAttempt {
    @PrimaryGeneratedColumn()
    id: number;
  
    @Column({
      name: 'event_id',
      type: 'varchar',
      length: 255,
    })
    eventId: string;
  
    @Column({
      name: 'attempt_number',
      type: 'integer',
    })
    attemptNumber: number;
  
    @Column({
      name: 'worker_id',
      type: 'varchar',
      length: 255,
    })
    workerId: string;
  
    @CreateDateColumn({
      name: 'started_at',
      type: 'timestamptz',
    })
    startedAt: Date;
  
    @Column({
      name: 'finished_at',
      type: 'timestamptz',
      nullable: true,
    })
    finishedAt: Date | null;
  
    @Column({
      type: 'varchar',
      length: 30,
      default: AttemptResult.RUNNING,
    })
    result: AttemptResult;
  
    @Column({
      type: 'text',
      nullable: true,
    })
    error: string | null;
  }
  