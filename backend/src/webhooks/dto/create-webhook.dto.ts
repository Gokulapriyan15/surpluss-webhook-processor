
import {
    IsDefined,
    IsNotEmpty,
    IsObject,
    IsString,
    MaxLength,
  } from 'class-validator';
  
  export class CreateWebhookDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    eventId: string;
  
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    type: string;
  
    @IsDefined()
    @IsObject()
    data: Record<string, unknown>;
  }
  