import {
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
export class CreateRoleDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{1,63}$/)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsArray()
  @ArrayUnique()
  @Matches(/^[a-z][a-z0-9.-]{1,99}$/, { each: true })
  permissions: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Matches(/^[a-z][a-z0-9.-]{1,99}$/, { each: true })
  permissions?: string[];
}

export class CreatePermissionDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9.-]{1,99}$/)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  group: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdatePermissionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  group?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
