import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { PutSyncAccountsDto, SyncAccountDto } from './dto/sync-accounts.dto';
import { PutSyncProvidersDto, SyncProviderDto } from './dto/sync-providers.dto';
import { SyncService } from './sync.service';

@UseGuards(JwtAuthGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('accounts')
  list(@CurrentUser() user: AuthUser) {
    return this.sync.list(user.id);
  }

  /**
   * Mobile clients only need the data rendered in the account overview.  Keep
   * the encrypted/synchronised auth payload on the desktop-only sync route.
   */
  @Get('accounts/summary')
  listSummary(@CurrentUser() user: AuthUser) {
    return this.sync.listSummary(user.id);
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

  @Get('providers')
  listProviders(@CurrentUser() user: AuthUser) {
    return this.sync.listProviders(user.id);
  }

  @Put('providers')
  replaceProviders(@CurrentUser() user: AuthUser, @Body() dto: PutSyncProvidersDto) {
    return this.sync.replaceProviders(user.id, dto);
  }

  @Put('providers/:id')
  upsertProvider(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SyncProviderDto,
  ) {
    return this.sync.upsertProvider(user.id, id, dto);
  }

  @Delete('providers/:id')
  deleteProvider(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.sync.deleteProvider(user.id, id);
  }
}
