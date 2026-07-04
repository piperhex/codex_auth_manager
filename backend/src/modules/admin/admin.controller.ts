import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';
import { CurrentUser, type AuthUser } from '@/common/decorators/user.decorator';
import { AdminGuard } from '@/common/guards/admin.guard';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { AdminService } from './admin.service';
import {
  ChangeAdminPasswordDto,
  CreateAdminUserDto,
  ListAdminUsersQueryDto,
  UpdateAdminUserDto,
} from './dto/admin-user.dto';
import {
  CreateApprovalRequestDto,
  CreateInvitationDto,
  ListAuditLogsQueryDto,
  PageQueryDto,
  ReviewApprovalRequestDto,
  UpdateAdminSyncedAccountDto,
} from './dto/admin-management.dto';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  page(@Res() response: Response) {
    return response.sendFile(join(process.cwd(), 'public', 'admin.html'));
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('api/users')
  listUsers(@Query() query: ListAdminUsersQueryDto) {
    return this.admin.listUsers(query);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('api/users')
  createUser(@CurrentUser() user: AuthUser, @Body() dto: CreateAdminUserDto) {
    return this.admin.createUser(user, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('api/users/:id')
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateAdminUserDto,
  ) {
    return this.admin.updateUser(user, id, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('api/users/:id')
  deleteUser(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.deleteUser(user, id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('api/profile/password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangeAdminPasswordDto) {
    return this.admin.changePassword(user, dto.currentPassword, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('api/users/:id/accounts')
  listUserAccounts(@Param('id') id: string) {
    return this.admin.listUserAccounts(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('api/users/:id/accounts/:accountId')
  updateUserAccount(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('accountId') accountId: string,
    @Body() dto: UpdateAdminSyncedAccountDto,
  ) {
    return this.admin.updateUserAccount(user, id, accountId, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('api/users/:id/accounts/:accountId')
  deleteUserAccount(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('accountId') accountId: string,
  ) {
    return this.admin.deleteUserAccount(user, id, accountId);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('api/audit-logs')
  listAuditLogs(@Query() query: ListAuditLogsQueryDto) {
    return this.admin.listAuditLogs(query);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('api/invitations')
  listInvitations(@Query() query: PageQueryDto) {
    return this.admin.listInvitations(query);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('api/invitations')
  createInvitation(@CurrentUser() user: AuthUser, @Body() dto: CreateInvitationDto) {
    return this.admin.createInvitation(user, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('api/invitations/:id')
  revokeInvitation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.revokeInvitation(user, id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('api/approvals')
  listApprovalRequests(@Query() query: PageQueryDto) {
    return this.admin.listApprovalRequests(query);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('api/approvals')
  createApprovalRequest(@CurrentUser() user: AuthUser, @Body() dto: CreateApprovalRequestDto) {
    return this.admin.createApprovalRequest(user, dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('api/approvals/:id/review')
  reviewApprovalRequest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReviewApprovalRequestDto,
  ) {
    return this.admin.reviewApprovalRequest(user, id, dto);
  }
}
