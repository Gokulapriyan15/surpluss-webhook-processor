    import {
        Injectable,
        ConflictException,
    } from '@nestjs/common';
    import { InjectDataSource } from '@nestjs/typeorm';
    import { DataSource } from 'typeorm';
    
    @Injectable()
    export class BusinessCompletionService {
        constructor(
        @InjectDataSource()
        private readonly dataSource: DataSource,
        ) {}
    
        async completeEvent(
        eventId: string,
        workerId: string,
        leaseToken: string,
        ): Promise<void> {
        await this.dataSource.transaction(async (manager) => {
            // 1. Verify that this worker still owns the event.
            const events = await manager.query(
            `
            SELECT event_id, payload, attempts
            FROM webhook_events
            WHERE event_id = $1
                AND status = 'processing'
                AND locked_by = $2
                AND lease_token = $3
            FOR UPDATE
            `,
            [eventId, workerId, leaseToken],
            );
    
            if (events.length === 0) {
            throw new ConflictException(
                'Worker no longer owns this event',
            );
            }
    
            // 2. Extract the order ID from the original payload.
            const payload = events[0].payload;
            const orderId = payload?.data?.orderId;
    
            if (
            typeof orderId !== 'string' ||
            orderId.trim().length === 0
            ) {
            throw new Error('Invalid or missing orderId');
            }
    
            // 3. Insert the business record.
            // The unique event_id constraint protects against duplicates.
            await manager.query(
            `
            INSERT INTO processed_orders (
                order_id,
                event_id,
                processed_at
            )
            VALUES ($1, $2, NOW())
            ON CONFLICT (event_id) DO NOTHING
            `,
            [orderId, eventId],
            );
    
            // 4. Close the attempt record as successful (same transaction as the
            // business row, so history can never disagree with processed_orders).
            await manager.query(
            `
            UPDATE processing_attempts
            SET
                finished_at = NOW(),
                result = 'success',
                error = NULL
            WHERE event_id = $1
                AND attempt_number = $2
                AND result = 'running'
            `,
            [eventId, events[0].attempts],
            );

            // 5. Mark the event as completed.
            await manager.query(
            `
            UPDATE webhook_events
            SET
                status = 'completed',
                next_retry_at = NULL,
                locked_by = NULL,
                lease_until = NULL,
                lease_token = NULL,
                updated_at = NOW()
            WHERE event_id = $1
            `,
            [eventId],
            );
        });
        }
    }