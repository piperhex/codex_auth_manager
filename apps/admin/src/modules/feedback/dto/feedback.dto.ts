import { Type } from 'class-transformer';
import {
  IsInt,
  IsEmail,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  IsUUID,
} from 'class-validator';

export class CreateFeedbackDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  version: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  platform: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;
}

export class ListFeedbackQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class SendFeedbackEmailDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content: string;

  @IsOptional()
  @IsUUID()
  mailServiceId?: string | null;
}
