import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import type { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { AppAnnouncementEntity } from './entities/app-announcement.entity';

const CURRENT_ANNOUNCEMENT_ID = 'current';

export interface AnnouncementResponse {
  content: string;
  enabled: boolean;
  textColor: string;
  backgroundColor: string;
  scrollDurationSeconds: number;
  updatedAt: string | null;
}

const DEFAULT_TEXT_COLOR = '#C4D7C8';
const DEFAULT_BACKGROUND_COLOR = '#203128';
const DEFAULT_SCROLL_DURATION_SECONDS = 22;

@Injectable()
export class AnnouncementService {
  constructor(
    @InjectRepository(AppAnnouncementEntity)
    private readonly announcements: Repository<AppAnnouncementEntity>,
    @InjectRepository(AdminAuditLogEntity)
    private readonly auditLogs: Repository<AdminAuditLogEntity>,
  ) {}

  async getPublic(): Promise<AnnouncementResponse> {
    const announcement = await this.findCurrent();
    const enabled = Boolean(announcement?.enabled && announcement.content.trim());
    return {
      content: enabled ? announcement!.content.trim() : '',
      enabled,
      textColor: announcement?.textColor ?? DEFAULT_TEXT_COLOR,
      backgroundColor: announcement?.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
      scrollDurationSeconds: announcement?.scrollDurationSeconds
        ?? DEFAULT_SCROLL_DURATION_SECONDS,
      updatedAt: announcement?.updatedAt?.toISOString() ?? null,
    };
  }

  async getAdmin(): Promise<AnnouncementResponse> {
    const announcement = await this.findCurrent();
    return {
      content: announcement?.content ?? '',
      enabled: announcement?.enabled ?? false,
      textColor: announcement?.textColor ?? DEFAULT_TEXT_COLOR,
      backgroundColor: announcement?.backgroundColor ?? DEFAULT_BACKGROUND_COLOR,
      scrollDurationSeconds: announcement?.scrollDurationSeconds
        ?? DEFAULT_SCROLL_DURATION_SECONDS,
      updatedAt: announcement?.updatedAt?.toISOString() ?? null,
    };
  }

  async update(actor: AuthUser, dto: UpdateAnnouncementDto): Promise<AnnouncementResponse> {
    const content = dto.content.trim();
    if (dto.enabled && !content) {
      throw new BadRequestException('Announcement content is required when enabled');
    }

    const existing = await this.findCurrent();
    const announcement = existing ?? this.announcements.create({ id: CURRENT_ANNOUNCEMENT_ID });
    announcement.content = content;
    announcement.enabled = dto.enabled;
    announcement.textColor = dto.textColor.toUpperCase();
    announcement.backgroundColor = dto.backgroundColor.toUpperCase();
    announcement.scrollDurationSeconds = dto.scrollDurationSeconds;
    announcement.updatedById = actor.id;
    announcement.updatedByEmail = actor.email;
    const saved = await this.announcements.save(announcement);

    await this.auditLogs.save(this.auditLogs.create({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'announcement.update',
      targetType: 'announcement',
      targetId: CURRENT_ANNOUNCEMENT_ID,
      metadata: {
        enabled: saved.enabled,
        scrollDurationSeconds: saved.scrollDurationSeconds,
      },
    }));

    return {
      content: saved.content,
      enabled: saved.enabled,
      textColor: saved.textColor,
      backgroundColor: saved.backgroundColor,
      scrollDurationSeconds: saved.scrollDurationSeconds,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  private findCurrent() {
    return this.announcements.findOne({ where: { id: CURRENT_ANNOUNCEMENT_ID } });
  }
}
