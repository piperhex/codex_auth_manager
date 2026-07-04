import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { UserEntity, UserRole } from './entities/user.entity';

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

  async validatePassword(user: UserEntity, password: string) {
    return bcrypt.compare(password, user.passwordHash);
  }

  async markLogin(userId: string) {
    await this.users.update({ id: userId }, { lastLoginAt: new Date() });
  }

  async listUsers() {
    return this.users.find({ order: { createdAt: 'DESC' } });
  }

  async updateUser(id: string, patch: { disabled?: boolean; role?: UserRole }) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (patch.disabled !== undefined) user.disabled = patch.disabled;
    if (patch.role) user.role = patch.role;
    return this.users.save(user);
  }
}
