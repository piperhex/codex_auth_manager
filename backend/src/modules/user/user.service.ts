import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { ILike, Not, Repository } from 'typeorm';
import { UserEntity, UserRole } from './entities/user.entity';

export interface ListUsersOptions {
  search?: string;
  role?: UserRole;
  status?: 'active' | 'disabled';
  page?: number;
  pageSize?: number;
}

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  async createUser({ email, password, role }: { email: string; password: string; role?: UserRole }) {
    const normalizedEmail = email.trim().toLowerCase();
    const exists = await this.users.exists({ where: { email: normalizedEmail } });
    if (exists) throw new BadRequestException('Email already exists');
    const count = await this.users.count();
    const user = this.users.create({
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      role: role ?? (count === 0 ? 'admin' : 'user'),
    });
    return this.users.save(user);
  }

  findByEmailWithPassword(email: string) {
    return this.users.findOne({
      where: { email: email.trim().toLowerCase() },
      select: ['id', 'email', 'passwordHash', 'role', 'disabled'],
    });
  }

  findActiveById(id: string) {
    return this.users.findOne({ where: { id, disabled: false } });
  }

  findById(id: string) {
    return this.users.findOne({ where: { id } });
  }

  findByIdWithPassword(id: string) {
    return this.users.findOne({
      where: { id },
      select: ['id', 'email', 'passwordHash', 'role', 'disabled'],
    });
  }

  async validatePassword(user: UserEntity, password: string) {
    return bcrypt.compare(password, user.passwordHash);
  }

  async markLogin(userId: string) {
    await this.users.update({ id: userId }, { lastLoginAt: new Date() });
  }

  async listUsers(options?: ListUsersOptions) {
    if (!options) {
      return this.users.find({ order: { createdAt: 'DESC' } });
    }

    const page = Math.max(1, Number(options.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(options.pageSize ?? 20)));
    const filters = {
      ...(options.role ? { role: options.role } : {}),
      ...(options.status ? { disabled: options.status === 'disabled' } : {}),
    };
    const search = options.search?.trim();
    const where = search ? { ...filters, email: ILike(`%${search}%`) } : filters;
    const [items, total] = await this.users.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  async updateUser(
    id: string,
    patch: { disabled?: boolean; role?: UserRole; email?: string; password?: string },
  ) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (patch.email !== undefined) {
      const normalizedEmail = patch.email.trim().toLowerCase();
      const exists = await this.users.exists({ where: { email: normalizedEmail, id: Not(id) } });
      if (exists) throw new BadRequestException('Email already exists');
      user.email = normalizedEmail;
    }
    if (patch.password !== undefined) {
      user.passwordHash = await bcrypt.hash(patch.password, 12);
    }
    if (patch.disabled !== undefined) user.disabled = patch.disabled;
    if (patch.role) user.role = patch.role;
    return this.users.save(user);
  }

  async changePassword(id: string, currentPassword: string, newPassword: string) {
    const user = await this.findByIdWithPassword(id);
    if (!user || user.disabled || !(await this.validatePassword(user, currentPassword))) {
      throw new UnauthorizedException('Current password is invalid');
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await this.users.save(user);
    return { ok: true };
  }

  async deleteUser(id: string) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'admin' && !user.disabled) {
      const activeAdmins = await this.users.count({ where: { role: 'admin', disabled: false } });
      if (activeAdmins <= 1) throw new BadRequestException('At least one active admin must remain');
    }
    await this.users.delete({ id });
    return { id, email: user.email };
  }
}
