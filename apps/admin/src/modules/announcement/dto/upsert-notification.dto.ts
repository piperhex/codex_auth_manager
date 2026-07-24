import {
  IsBoolean,
  IsISO8601,
  IsString,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpsertNotificationDto {
  @IsString()
  @MaxLength(160)
  titleZh: string;

  @IsString()
  @MaxLength(160)
  titleEn: string;

  @IsString()
  @MaxLength(4000)
  contentZh: string;

  @IsString()
  @MaxLength(4000)
  contentEn: string;

  @IsString()
  @MaxLength(2048)
  @ValidateIf((_object, value) => value !== '')
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  link: string;

  @IsString()
  @MaxLength(80)
  linkLabelZh: string;

  @IsString()
  @MaxLength(80)
  linkLabelEn: string;

  @IsBoolean()
  enabled: boolean;

  @IsISO8601()
  publishedAt: string;
}
