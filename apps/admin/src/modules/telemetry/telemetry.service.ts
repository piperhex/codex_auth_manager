import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CreateInstallationEventDto } from './dto/create-installation-event.dto';
import { DeviceInstallationEntity } from './entities/device-installation.entity';
import { DeviceTelemetryEventEntity } from './entities/device-telemetry-event.entity';
import type {
  ListDeviceInstallationsQueryDto,
  ListTelemetryEventsQueryDto,
} from './dto/list-telemetry.dto';

const TELEMETRY_PLATFORMS = ['windows', 'macos', 'linux'] as const;

interface PlatformCountRow {
  platform: typeof TELEMETRY_PLATFORMS[number];
  count: string;
}

@Injectable()
export class TelemetryService {
  constructor(
    @InjectRepository(DeviceInstallationEntity)
    private readonly installations: Repository<DeviceInstallationEntity>,
    @InjectRepository(DeviceTelemetryEventEntity)
    private readonly events: Repository<DeviceTelemetryEventEntity>,
  ) {}

  async recordInstallation(dto: CreateInstallationEventDto) {
    await this.installations.upsert({
      deviceId: dto.deviceId,
      platform: dto.platform,
    }, ['deviceId']);
    if (dto.eventType === 'base_url_changed') {
      await this.events.save(this.events.create({
        deviceId: dto.deviceId,
        platform: dto.platform,
        eventType: dto.eventType,
      }));
    }
    return { ok: true };
  }

  async getOverview() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const platformCountsQuery = this.installations.createQueryBuilder('installation')
      .select('installation.platform', 'platform')
      .addSelect('COUNT(*)', 'count')
      .groupBy('installation.platform')
      .getRawMany<PlatformCountRow>();
    const [
      totalInstallations,
      installationsLast30Days,
      totalEvents,
      eventsLast30Days,
      platformRows,
    ] = await Promise.all([
      this.installations.count(),
      this.installations.createQueryBuilder('installation')
        .where('installation.firstSeenAt >= :since', { since: thirtyDaysAgo })
        .getCount(),
      this.events.count(),
      this.events.createQueryBuilder('event')
        .where('event.createdAt >= :since', { since: thirtyDaysAgo })
        .getCount(),
      platformCountsQuery,
    ]);
    const platforms = Object.fromEntries(
      TELEMETRY_PLATFORMS.map((platform) => [platform, 0]),
    ) as Record<typeof TELEMETRY_PLATFORMS[number], number>;
    for (const row of platformRows) platforms[row.platform] = Number(row.count);
    return {
      totalInstallations,
      installationsLast30Days,
      totalEvents,
      eventsLast30Days,
      platforms,
    };
  }

  async listInstallations(query: ListDeviceInstallationsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const builder = this.installations.createQueryBuilder('installation');
    const search = query.search?.trim();
    if (search) {
      builder.andWhere('CAST(installation.deviceId AS text) ILIKE :search', {
        search: `%${search}%`,
      });
    }
    if (query.platform) {
      builder.andWhere('installation.platform = :platform', { platform: query.platform });
    }
    const [items, total] = await builder
      .orderBy('installation.firstSeenAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items, total, page, pageSize };
  }

  async listEvents(query: ListTelemetryEventsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const builder = this.events.createQueryBuilder('event');
    const search = query.search?.trim();
    if (search) {
      builder.andWhere('CAST(event.deviceId AS text) ILIKE :search', {
        search: `%${search}%`,
      });
    }
    if (query.platform) {
      builder.andWhere('event.platform = :platform', { platform: query.platform });
    }
    if (query.eventType) {
      builder.andWhere('event.eventType = :eventType', { eventType: query.eventType });
    }
    const [items, total] = await builder
      .orderBy('event.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items, total, page, pageSize };
  }
}
