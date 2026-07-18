import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const telemetryPlatforms = ['windows', 'macos', 'linux', 'android', 'ios'] as const;

export class TelemetryPageQueryDto {
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

export class ListDeviceInstallationsQueryDto extends TelemetryPageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(36)
  search?: string;

  @IsOptional()
  @IsIn(telemetryPlatforms)
  platform?: typeof telemetryPlatforms[number];
}

export class ListTelemetryEventsQueryDto extends ListDeviceInstallationsQueryDto {
  @IsOptional()
  @IsIn(['base_url_changed'])
  eventType?: 'base_url_changed';
}
