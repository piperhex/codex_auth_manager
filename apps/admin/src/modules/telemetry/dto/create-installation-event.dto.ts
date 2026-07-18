import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateInstallationEventDto {
  @IsUUID('4')
  deviceId: string;

  @IsIn(['windows', 'macos', 'linux', 'android', 'ios'])
  platform: 'windows' | 'macos' | 'linux' | 'android' | 'ios';

  @IsOptional()
  @IsString()
  @MaxLength(50)
  appVersion?: string;

  @IsIn(['installation', 'base_url_changed'])
  eventType: 'installation' | 'base_url_changed';
}
