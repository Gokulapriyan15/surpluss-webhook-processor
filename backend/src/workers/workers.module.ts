
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessCompletionService } from './business-completion.service';
import { WorkerService } from './worker.service';

@Module({
  imports: [TypeOrmModule.forFeature([])],
  providers: [
    BusinessCompletionService,
    WorkerService,
  ],
  exports: [
    BusinessCompletionService,
  ],
})
export class WorkersModule {}
