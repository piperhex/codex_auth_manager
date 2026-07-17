import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { AnnouncementController } from '@/modules/announcement/announcement.controller';
import { AnnouncementService } from '@/modules/announcement/announcement.service';
import type { AppAnnouncementEntity } from '@/modules/announcement/entities/app-announcement.entity';
import type { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';

function createService() {
  const announcements = {
    findOne: vi.fn(),
    create: vi.fn((value) => value),
    save: vi.fn(),
  };
  const auditLogs = {
    create: vi.fn((value) => value),
    save: vi.fn(),
  };
  const service = new AnnouncementService(
    announcements as unknown as Repository<AppAnnouncementEntity>,
    auditLogs as unknown as Repository<AdminAuditLogEntity>,
  );
  return { service, announcements, auditLogs };
}

describe('AnnouncementService', () => {
  const actor: AuthUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };

  it('returns a disabled default announcement when none is configured', async () => {
    const { service, announcements } = createService();
    announcements.findOne.mockResolvedValue(null);

    await expect(service.getPublic()).resolves.toEqual({
      content: '',
      enabled: false,
      textColor: '#C4D7C8',
      backgroundColor: '#203128',
      scrollDurationSeconds: 22,
      updatedAt: null,
    });
  });

  it('trims content, normalizes colors, and records an audit entry', async () => {
    const { service, announcements, auditLogs } = createService();
    const updatedAt = new Date('2026-07-17T12:00:00.000Z');
    announcements.findOne.mockResolvedValue(null);
    announcements.save.mockImplementation(async (value) => ({ ...value, updatedAt }));

    await expect(service.update(actor, {
      content: '  Service maintenance tonight  ',
      enabled: true,
      textColor: '#aabbcc',
      backgroundColor: '#112233',
      scrollDurationSeconds: 15,
    })).resolves.toEqual({
      content: 'Service maintenance tonight',
      enabled: true,
      textColor: '#AABBCC',
      backgroundColor: '#112233',
      scrollDurationSeconds: 15,
      updatedAt: updatedAt.toISOString(),
    });

    expect(announcements.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'current' }));
    expect(auditLogs.save).toHaveBeenCalledWith(expect.objectContaining({
      action: 'announcement.update',
      targetId: 'current',
      metadata: { enabled: true, scrollDurationSeconds: 15 },
    }));
  });

  it('rejects publishing an empty announcement', async () => {
    const { service } = createService();

    await expect(service.update(actor, {
      content: '   ',
      enabled: true,
      textColor: '#C4D7C8',
      backgroundColor: '#203128',
      scrollDurationSeconds: 22,
    })).rejects.toThrow('Announcement content is required when enabled');
  });
});

describe('AnnouncementController', () => {
  it('delegates public reads and admin updates', async () => {
    const announcements = {
      getPublic: vi.fn().mockResolvedValue('public-announcement'),
      getAdmin: vi.fn().mockResolvedValue('admin-announcement'),
      update: vi.fn().mockResolvedValue('updated-announcement'),
    };
    const controller = new AnnouncementController(announcements as unknown as AnnouncementService);
    const actor: AuthUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
    const dto = {
      content: 'Notice',
      enabled: true,
      textColor: '#FFFFFF',
      backgroundColor: '#000000',
      scrollDurationSeconds: 22,
    };

    await expect(controller.getCurrent()).resolves.toBe('public-announcement');
    await expect(controller.getAdminConfig()).resolves.toBe('admin-announcement');
    await expect(controller.update(actor, dto)).resolves.toBe('updated-announcement');
    expect(announcements.update).toHaveBeenCalledWith(actor, dto);
  });
});
