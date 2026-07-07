import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class SyncProviderDto {
  @IsString()
  @MaxLength(64)
  id: string;

  @IsString()
  @MaxLength(160)
  name: string;

  @IsString()
  @MaxLength(500)
  baseUrl: string;

  @IsString()
  apiKey: string;

  @IsString()
  @MaxLength(160)
  model: string;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  models: string[] = [];

  @IsBoolean()
  modelSelectionControlledByCodex: boolean = false;

  @IsIn(['openaiResponses', 'openaiChat'])
  apiFormat: 'openaiResponses' | 'openaiChat';

  @IsOptional()
  @IsString()
  @MaxLength(40)
  lastModifiedAt?: string;
}

export class PutSyncProvidersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncProviderDto)
  providers: SyncProviderDto[];
}
