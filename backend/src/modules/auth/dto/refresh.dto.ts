import { IsString } from 'class-validator';

export class RefreshDto {
  @IsString()
  refreshToken: string;
}
