import type { Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { DeviceInstallationEntity } from '@/modules/telemetry/entities/device-installation.entity';
import type { DeviceTelemetryEventEntity } from '@/modules/telemetry/entities/device-telemetry-event.entity';
import { TelemetryAdminController } from '@/modules/telemetry/telemetry-admin.controller';
import { TelemetryController } from '@/modules/telemetry/telemetry.controller';
import { TelemetryService } from '@/modules/telemetry/telemetry.service';

function makeQueryBuilder() {
  const builder = {
    select: vi.fn(),
    addSelect: vi.fn(),
    groupBy: vi.fn(),
    where: vi.fn(),
    andWhere: vi.fn(),
    orderBy: vi.fn(),
    skip: vi.fn(),
    take: vi.fn(),
    getRawMany: vi.fn(),
    getCount: vi.fn(),
    getManyAndCount: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.addSelect.mockReturnValue(builder);
  builder.groupBy.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.andWhere.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  builder.skip.mockReturnValue(builder);
  builder.take.mockReturnValue(builder);
  return builder;
}

describe('TelemetryService', () => {
  it('stores installation events idempotently by device ID', async () => {
    const installations = { upsert: vi.fn().mockResolvedValue({}) };
    const events = { create: vi.fn((value) => value), save: vi.fn() };
    const service = new TelemetryService(
      installations as unknown as Repository<DeviceInstallationEntity>,
      events as unknown as Repository<DeviceTelemetryEventEntity>,
    );
    const event = {
      deviceId: '18f72fe6-1ec1-4d68-b5c1-f1b52b67503f',
      platform: 'windows' as const,
      eventType: 'installation' as const,
    };

    await expect(service.recordInstallation(event)).resolves.toEqual({ ok: true });
    expect(installations.upsert).toHaveBeenCalledWith({
      deviceId: event.deviceId,
      platform: event.platform,
    }, ['deviceId']);
    expect(events.save).not.toHaveBeenCalled();
  });

  it('records every base URL change as a separate event', async () => {
    const installations = { upsert: vi.fn().mockResolvedValue({}) };
    const events = { create: vi.fn((value) => value), save: vi.fn().mockResolvedValue({}) };
    const service = new TelemetryService(
      installations as unknown as Repository<DeviceInstallationEntity>,
      events as unknown as Repository<DeviceTelemetryEventEntity>,
    );
    const event = {
      deviceId: '18f72fe6-1ec1-4d68-b5c1-f1b52b67503f',
      platform: 'macos' as const,
      eventType: 'base_url_changed' as const,
    };

    await expect(service.recordInstallation(event)).resolves.toEqual({ ok: true });
    expect(events.save).toHaveBeenCalledWith(event);
  });

  it('summarizes installations, recent activity and platform totals', async () => {
    const platformBuilder = makeQueryBuilder();
    platformBuilder.getRawMany.mockResolvedValue([
      { platform: 'windows', count: '7' },
      { platform: 'macos', count: '3' },
    ]);
    const recentInstallationsBuilder = makeQueryBuilder();
    recentInstallationsBuilder.getCount.mockResolvedValue(4);
    const recentEventsBuilder = makeQueryBuilder();
    recentEventsBuilder.getCount.mockResolvedValue(2);
    const installations = {
      count: vi.fn().mockResolvedValue(10),
      createQueryBuilder: vi.fn()
        .mockReturnValueOnce(platformBuilder)
        .mockReturnValueOnce(recentInstallationsBuilder),
    };
    const events = {
      count: vi.fn().mockResolvedValue(6),
      createQueryBuilder: vi.fn().mockReturnValue(recentEventsBuilder),
    };
    const service = new TelemetryService(
      installations as unknown as Repository<DeviceInstallationEntity>,
      events as unknown as Repository<DeviceTelemetryEventEntity>,
    );

    await expect(service.getOverview()).resolves.toEqual({
      totalInstallations: 10,
      installationsLast30Days: 4,
      totalEvents: 6,
      eventsLast30Days: 2,
      platforms: { windows: 7, macos: 3, linux: 0 },
    });
    expect(recentInstallationsBuilder.where).toHaveBeenCalledWith(
      'installation.firstSeenAt >= :since',
      { since: expect.any(Date) },
    );
    expect(recentEventsBuilder.where).toHaveBeenCalledWith(
      'event.createdAt >= :since',
      { since: expect.any(Date) },
    );
  });

  it('paginates and filters installation and event records', async () => {
    const installationBuilder = makeQueryBuilder();
    installationBuilder.getManyAndCount.mockResolvedValue([[{ deviceId: 'device-1' }], 1]);
    const eventBuilder = makeQueryBuilder();
    eventBuilder.getManyAndCount.mockResolvedValue([[{ id: 'event-1' }], 1]);
    const installations = { createQueryBuilder: vi.fn().mockReturnValue(installationBuilder) };
    const events = { createQueryBuilder: vi.fn().mockReturnValue(eventBuilder) };
    const service = new TelemetryService(
      installations as unknown as Repository<DeviceInstallationEntity>,
      events as unknown as Repository<DeviceTelemetryEventEntity>,
    );

    await expect(service.listInstallations({
      page: 2,
      pageSize: 10,
      search: '18f72',
      platform: 'windows',
    })).resolves.toEqual({ items: [{ deviceId: 'device-1' }], total: 1, page: 2, pageSize: 10 });
    expect(installationBuilder.andWhere).toHaveBeenCalledWith(
      'CAST(installation.deviceId AS text) ILIKE :search',
      { search: '%18f72%' },
    );
    expect(installationBuilder.andWhere).toHaveBeenCalledWith(
      'installation.platform = :platform',
      { platform: 'windows' },
    );
    expect(installationBuilder.skip).toHaveBeenCalledWith(10);

    await expect(service.listEvents({
      page: 1,
      pageSize: 25,
      search: 'device',
      platform: 'linux',
      eventType: 'base_url_changed',
    })).resolves.toEqual({ items: [{ id: 'event-1' }], total: 1, page: 1, pageSize: 25 });
    expect(eventBuilder.andWhere).toHaveBeenCalledWith(
      'event.eventType = :eventType',
      { eventType: 'base_url_changed' },
    );
    expect(eventBuilder.take).toHaveBeenCalledWith(25);
  });
});

describe('TelemetryController', () => {
  it('delegates installation events to the service', async () => {
    const telemetry = { recordInstallation: vi.fn().mockResolvedValue({ ok: true }) };
    const controller = new TelemetryController(telemetry as unknown as TelemetryService);
    const event = {
      deviceId: '18f72fe6-1ec1-4d68-b5c1-f1b52b67503f',
      platform: 'linux' as const,
      eventType: 'base_url_changed' as const,
    };

    await expect(controller.recordInstallation(event)).resolves.toEqual({ ok: true });
    expect(telemetry.recordInstallation).toHaveBeenCalledWith(event);
  });

  it('delegates protected telemetry reads to the service', async () => {
    const telemetry = {
      getOverview: vi.fn().mockResolvedValue('overview'),
      listInstallations: vi.fn().mockResolvedValue('installations'),
      listEvents: vi.fn().mockResolvedValue('events'),
    };
    const controller = new TelemetryAdminController(telemetry as unknown as TelemetryService);
    const installationQuery = { page: 2, platform: 'windows' as const };
    const eventQuery = { page: 3, eventType: 'base_url_changed' as const };

    await expect(controller.overview()).resolves.toBe('overview');
    await expect(controller.listInstallations(installationQuery)).resolves.toBe('installations');
    await expect(controller.listEvents(eventQuery)).resolves.toBe('events');
    expect(telemetry.listInstallations).toHaveBeenCalledWith(installationQuery);
    expect(telemetry.listEvents).toHaveBeenCalledWith(eventQuery);
  });
});
