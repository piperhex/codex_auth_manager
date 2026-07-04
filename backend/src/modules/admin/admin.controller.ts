import { Body, Controller, Get, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';
import { AdminGuard } from '@/common/guards/admin.guard';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import { UserService } from '@/modules/user/user.service';
import { CreateAdminUserDto, UpdateAdminUserDto } from './dto/admin-user.dto';

@Controller('admin')
export class AdminController {
  constructor(private readonly users: UserService) {}

  @Get()
  page(@Res() response: Response) {
    return response.sendFile(join(process.cwd(), 'public', 'admin.html'));
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('api/users')
  listUsers() {
    return this.users.listUsers();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('api/users')
  createUser(@Body() dto: CreateAdminUserDto) {
    return this.users.createUser(dto);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('api/users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateAdminUserDto) {
    return this.users.updateUser(id, dto);
  }
}
