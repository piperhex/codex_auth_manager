import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequirePermissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permission } from '@/common/rbac/permissions';
import { JwtAuthGuard } from '@/modules/jwt/jwt-auth.guard';
import {
  ListDeviceInstallationsQueryDto,
  ListTelemetryEventsQueryDto,
} from './dto/list-telemetry.dto';
import { TelemetryService } from './telemetry.service';

@Controller('admin/api/telemetry')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.TelemetryRead)
export class TelemetryAdminController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Get('overview')
  overview() {
    return this.telemetry.getOverview();
  }

  @Get('installations')
  listInstallations(@Query() query: ListDeviceInstallationsQueryDto) {
    return this.telemetry.listInstallations(query);
  }

  @Get('events')
  listEvents(@Query() query: ListTelemetryEventsQueryDto) {
    return this.telemetry.listEvents(query);
  }
}
