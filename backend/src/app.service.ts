
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return {
      status: 'success',
      message: 'Surpluss Webhook Processor API is running',
      service: 'backend',
      timestamp: new Date().toISOString(),
    };
  }
}
