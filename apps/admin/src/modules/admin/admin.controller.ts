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
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permission } from '@/common/rbac/permissions';
import {
  CreatePermissionDto,
  CreateRoleDto,
  UpdatePermissionDto,
  UpdateRoleDto,
} from '@/modules/rbac/dto/rbac.dto';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { AdminService } from './admin.service';
import { OfficialAccountOAuthService } from './official-account-oauth.service';
import { OfficialAccountImportService } from './official-account-import.service';
import {
  ChangeAdminPasswordDto,
  CreateAdminUserDto,
  ListAdminUsersQueryDto,
  UpdateAdminUserDto,
} from './dto/admin-user.dto';
import {
  CreateApprovalRequestDto,
  ChangeSystemAccountBindingsDto,
  CreateSystemAccountDto,
  ImportSystemAccountsDto,
  CreateInvitationDto,
  ListAuditLogsQueryDto,
  ListSystemAccountsQueryDto,
  PageQueryDto,
  ReviewApprovalRequestDto,
  UpdateAdminSyncedAccountDto,
  UpdateOwnSyncedAccountDto,
  UpdateSystemAccountDto,
} from './dto/admin-management.dto';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly officialAccountOAuth: OfficialAccountOAuthService,
    private readonly officialAccountImport: OfficialAccountImportService,
  ) {}

  @Get()
  page(@Res() response: Response) {
    return response.sendFile(join(process.cwd(), 'public', 'admin.html'));
  }

  @Get('reset-password')
  resetPasswordPage(@Res() response: Response) {
    return response.sendFile(join(process.cwd(), 'public', 'admin.html'));
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.RolesRead)
  @Get('api/roles')
  listRoles() {
    return this.admin.listRoles();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.RolesRead)
  @Get('api/permissions')
  listPermissions() {
    return this.admin.listPermissions();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PermissionsManage)
  @Post('api/permissions')
  createPermission(@CurrentUser() user: AuthUser, @Body() dto: CreatePermissionDto) {
    return this.admin.createPermission(user, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PermissionsManage)
  @Patch('api/permissions/:code')
  updatePermission(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body() dto: UpdatePermissionDto,
  ) {
    return this.admin.updatePermission(user, code, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.RolesManage)
  @Post('api/roles')
  createRole(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto) {
    return this.admin.createRole(user, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.RolesManage)
  @Patch('api/roles/:code')
  updateRole(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.admin.updateRole(user, code, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.RolesManage)
  @Delete('api/roles/:code')
  deleteRole(@CurrentUser() user: AuthUser, @Param('code') code: string) {
    return this.admin.deleteRole(user, code);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.UsersRead)
  @Get('api/users')
  listUsers(@Query() query: ListAdminUsersQueryDto) {
    return this.admin.listUsers(query);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.UsersManage)
  @Post('api/users')
  createUser(@CurrentUser() user: AuthUser, @Body() dto: CreateAdminUserDto) {
    return this.admin.createUser(user, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.UsersManage)
  @Patch('api/users/:id')
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateAdminUserDto,
  ) {
    return this.admin.updateUser(user, id, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.UsersManage)
  @Delete('api/users/:id')
  deleteUser(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.deleteUser(user, id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.SelfPasswordUpdate)
  @Patch('api/profile/password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangeAdminPasswordDto) {
    return this.admin.changePassword(user, dto.currentPassword, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.SelfAccountsRead)
  @Get('api/profile/accounts')
  listOwnAccounts(@CurrentUser() user: AuthUser) {
    return this.admin.listOwnAccounts(user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.SelfAccountsWrite)
  @Patch('api/profile/accounts/:accountId')
  updateOwnAccount(
    @CurrentUser() user: AuthUser,
    @Param('accountId') accountId: string,
    @Body() dto: UpdateOwnSyncedAccountDto,
  ) {
    return this.admin.updateOwnAccount(user, accountId, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.UsersRead)
  @Get('api/users/:id/accounts')
  listUserAccounts(@Param('id') id: string) {
    return this.admin.listUserAccounts(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.UsersRead)
  @Get('api/users/:id/providers')
  listUserProviders(@Param('id') id: string) {
    return this.admin.listUserProviders(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.UsersRead, Permission.OfficialAccountsManage)
  @Post('api/users/:id/accounts/:accountId/add-to-pool')
  addUserAccountToSystemPool(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('accountId') accountId: string,
  ) {
    return this.admin.addUserAccountToSystemPool(user, id, accountId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.UsersManage)
  @Patch('api/users/:id/accounts/:accountId')
  updateUserAccount(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('accountId') accountId: string,
    @Body() dto: UpdateAdminSyncedAccountDto,
  ) {
    return this.admin.updateUserAccount(user, id, accountId, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.UsersManage)
  @Delete('api/users/:id/accounts/:accountId')
  deleteUserAccount(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('accountId') accountId: string,
  ) {
    return this.admin.deleteUserAccount(user, id, accountId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.OfficialAccountsRead)
  @Get('api/official-accounts')
  listSystemAccounts(@Query() query: ListSystemAccountsQueryDto) {
    return this.admin.listSystemAccounts(query);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.OfficialAccountsManage)
  @Post('api/official-accounts')
  createSystemAccount(@CurrentUser() user: AuthUser, @Body() dto: CreateSystemAccountDto) {
    return this.admin.createSystemAccount(user, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.OfficialAccountsManage)
  @Post('api/official-accounts/import')
  importSystemAccounts(@CurrentUser() user: AuthUser, @Body() dto: ImportSystemAccountsDto) {
    return this.officialAccountImport.import(user, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.OfficialAccountsManage)
  @Post('api/official-accounts/import/sub2api')
  importSub2apiSystemAccounts(@CurrentUser() user: AuthUser, @Body() dto: ImportSystemAccountsDto) {
    return this.officialAccountImport.importSub2api(user, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.OfficialAccountsManage)
  @Post('api/official-accounts/oauth/start')
  startSystemAccountOAuth(@CurrentUser() user: AuthUser) {
    return this.officialAccountOAuth.start(user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.OfficialAccountsManage)
  @Post('api/official-accounts/oauth/:sessionId/poll')
  pollSystemAccountOAuth(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
  ) {
    return this.officialAccountOAuth.poll(user, sessionId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.OfficialAccountsManage)
  @Patch('api/official-accounts/:id')
  updateSystemAccount(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSystemAccountDto,
  ) {
    return this.admin.updateSystemAccount(user, id, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.OfficialAccountsManage)
  @Delete('api/official-accounts/:id')
  deleteSystemAccount(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.deleteSystemAccount(user, id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.OfficialAccountsRead)
  @Get('api/official-accounts/:id/bindings')
  listSystemAccountBindings(@Param('id') id: string) {
    return this.admin.listSystemAccountBindings(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.OfficialAccountsManage)
  @Post('api/official-accounts/bind')
  bindSystemAccounts(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangeSystemAccountBindingsDto,
  ) {
    return this.admin.bindSystemAccounts(user, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.OfficialAccountsManage)
  @Post('api/official-accounts/unbind')
  unbindSystemAccounts(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangeSystemAccountBindingsDto,
  ) {
    return this.admin.unbindSystemAccounts(user, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.AuditLogsRead)
  @Get('api/audit-logs')
  listAuditLogs(@Query() query: ListAuditLogsQueryDto) {
    return this.admin.listAuditLogs(query);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.InvitationsRead)
  @Get('api/invitations')
  listInvitations(@Query() query: PageQueryDto) {
    return this.admin.listInvitations(query);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.InvitationsRead)
  @Get('api/invitations/:id/users')
  listInvitationUsers(@Param('id') id: string, @Query() query: PageQueryDto) {
    return this.admin.listInvitationUsers(id, query);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.InvitationsManage)
  @Post('api/invitations')
  createInvitation(@CurrentUser() user: AuthUser, @Body() dto: CreateInvitationDto) {
    return this.admin.createInvitation(user, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.InvitationsManage)
  @Post('api/invitations/:id/token')
  getInvitationToken(@Param('id') id: string) {
    return this.admin.getInvitationToken(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.InvitationsManage)
  @Delete('api/invitations/:id')
  revokeInvitation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.admin.revokeInvitation(user, id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ApprovalsRead)
  @Get('api/approvals')
  listApprovalRequests(@Query() query: PageQueryDto) {
    return this.admin.listApprovalRequests(query);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ApprovalsManage)
  @Post('api/approvals')
  createApprovalRequest(@CurrentUser() user: AuthUser, @Body() dto: CreateApprovalRequestDto) {
    return this.admin.createApprovalRequest(user, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ApprovalsManage)
  @Post('api/approvals/:id/review')
  reviewApprovalRequest(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReviewApprovalRequestDto,
  ) {
    return this.admin.reviewApprovalRequest(user, id, dto);
  }
}
