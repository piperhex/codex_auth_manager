import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { PutSyncAccountsDto, SyncAccountDto } from './dto/sync-accounts.dto';
import { SyncService } from './sync.service';

@UseGuards(JwtAuthGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('accounts')
  list(@CurrentUser() user: AuthUser) {
    return this.sync.list(user.id);
  }

  @Put('accounts')
  replace(@CurrentUser() user: AuthUser, @Body() dto: PutSyncAccountsDto) {
    return this.sync.replace(user.id, dto);
  }

  @Put('accounts/:id')
  upsert(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SyncAccountDto) {
    return this.sync.upsert(user.id, id, dto);
  }

  @Delete('accounts/:id')
  delete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sync.delete(user.id, id);
  }
}
