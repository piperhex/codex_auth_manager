import { Type } from 'class-transformer';
import {
  IsEmail,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { UserRole } from '@/modules/user/entities/user.entity';

export class PageQueryDto {
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

export class ListAuditLogsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;
}

export class CreateInvitationDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: UserRole;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  expiresInHours?: number;
}

export class CreateApprovalRequestDto {
  @IsIn(['promote_user_to_admin'])
  type: 'promote_user_to_admin';

  @IsString()
  targetUserId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class ReviewApprovalRequestDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class UpdateAdminSyncedAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  email?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  expiresAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  plan?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  accountId?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsObject()
  usage?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  auth?: Record<string, unknown>;
}
