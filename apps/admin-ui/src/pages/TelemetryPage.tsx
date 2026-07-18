import { Button, Input, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { RefreshCw, Search } from "lucide-react";
import { useI18n } from "../i18n-context";
import type {
  DeviceInstallation,
  PageResult,
  TelemetryEvent,
  TelemetryFilters,
  TelemetryOverview,
  TelemetryPlatform,
} from "../types";
import { formatDate } from "../utils/format";

interface TelemetryPageProps {
  overview: TelemetryOverview;
  installations: PageResult<DeviceInstallation>;
  events: PageResult<TelemetryEvent>;
  overviewLoading: boolean;
  installationsLoading: boolean;
  eventsLoading: boolean;
  installationFilters: TelemetryFilters;
  eventFilters: TelemetryFilters;
  onInstallationFiltersChange: (filters: TelemetryFilters) => void;
  onEventFiltersChange: (filters: TelemetryFilters) => void;
  onLoadOverview: () => void | Promise<void>;
  onLoadInstallations: (page?: number, pageSize?: number) => void | Promise<void>;
  onLoadEvents: (page?: number, pageSize?: number) => void | Promise<void>;
}

const platforms: TelemetryPlatform[] = ["windows", "macos", "linux", "android", "ios"];

const platformColors: Record<TelemetryPlatform, string> = {
  windows: "blue",
  macos: "purple",
  linux: "orange",
  android: "green",
  ios: "cyan",
};

export function TelemetryPage({
  overview,
  installations,
  events,
  overviewLoading,
  installationsLoading,
  eventsLoading,
  installationFilters,
  eventFilters,
  onInstallationFiltersChange,
  onEventFiltersChange,
  onLoadOverview,
  onLoadInstallations,
  onLoadEvents,
}: TelemetryPageProps) {
  const { language, t } = useI18n();
  const platformOptions = platforms.map((platform) => ({
    value: platform,
    label: t(`telemetry.platform.${platform}`),
  }));
  const platformTag = (platform: TelemetryPlatform) => (
    <Tag color={platformColors[platform]}>
      {t(`telemetry.platform.${platform}`)}
    </Tag>
  );

  const installationColumns: TableColumnsType<DeviceInstallation> = [
    {
      title: t("telemetry.deviceId"),
      dataIndex: "deviceId",
      render: (value: string) => <Typography.Text code copyable>{value}</Typography.Text>,
    },
    {
      title: t("telemetry.platform"),
      dataIndex: "platform",
      width: 130,
      render: platformTag,
    },
    {
      title: t("telemetry.appVersion"),
      dataIndex: "appVersion",
      width: 130,
      render: (value?: string | null) => value || "-",
    },
    {
      title: t("telemetry.firstSeenAt"),
      dataIndex: "firstSeenAt",
      width: 190,
      render: (value: string) => formatDate(value, language),
    },
  ];

  const eventColumns: TableColumnsType<TelemetryEvent> = [
    {
      title: t("telemetry.eventTime"),
      dataIndex: "createdAt",
      width: 190,
      render: (value: string) => formatDate(value, language),
    },
    {
      title: t("telemetry.deviceId"),
      dataIndex: "deviceId",
      render: (value: string) => <Typography.Text code copyable>{value}</Typography.Text>,
    },
    {
      title: t("telemetry.platform"),
      dataIndex: "platform",
      width: 130,
      render: platformTag,
    },
    {
      title: t("telemetry.eventType"),
      dataIndex: "eventType",
      width: 180,
      render: () => <Tag color="geekblue">{t("telemetry.event.baseUrlChanged")}</Tag>,
    },
  ];

  const filterBar = (
    filters: TelemetryFilters,
    onFiltersChange: (filters: TelemetryFilters) => void,
    onLoad: (page?: number, pageSize?: number) => void | Promise<void>,
    total: number,
    totalKey: "telemetry.installationsTotal" | "telemetry.eventsTotal",
  ) => (
    <div className="toolbar telemetry-table-toolbar">
      <div className="toolbar-left">
        <Input
          allowClear
          prefix={<Search size={15} />}
          placeholder={t("telemetry.searchPlaceholder")}
          value={filters.search}
          onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
          onPressEnter={() => onLoad(1)}
          style={{ width: 300 }}
        />
        <Select
          allowClear
          placeholder={t("telemetry.platform")}
          value={filters.platform}
          options={platformOptions}
          onChange={(platform) => onFiltersChange({ ...filters, platform })}
          style={{ width: 150 }}
        />
        <Button icon={<Search size={15} />} onClick={() => onLoad(1)}>{t("common.filter")}</Button>
      </div>
      <Typography.Text type="secondary">{t(totalKey, { count: total })}</Typography.Text>
    </div>
  );

  return (
    <>
      <h1 className="page-title">{t("telemetry.title")}</h1>
      <Typography.Paragraph type="secondary">{t("telemetry.description")}</Typography.Paragraph>
      <div className="summary-grid">
        <div className="metric"><span>{t("telemetry.totalInstallations")}</span><strong>{overview.totalInstallations}</strong></div>
        <div className="metric"><span>{t("telemetry.installationsLast30Days")}</span><strong>{overview.installationsLast30Days}</strong></div>
        <div className="metric"><span>{t("telemetry.totalEvents")}</span><strong>{overview.totalEvents}</strong></div>
        <div className="metric"><span>{t("telemetry.eventsLast30Days")}</span><strong>{overview.eventsLast30Days}</strong></div>
      </div>
      <div className="toolbar">
        <Space wrap>
          <Typography.Text type="secondary">{t("telemetry.platformDistribution")}</Typography.Text>
          {platforms.map((platform) => (
            <Tag key={platform}>{t(`telemetry.platform.${platform}`)}: {overview.platforms[platform]}</Tag>
          ))}
        </Space>
        <Button
          loading={overviewLoading || installationsLoading || eventsLoading}
          icon={<RefreshCw size={15} />}
          onClick={() => {
            void onLoadOverview();
            void onLoadInstallations();
            void onLoadEvents();
          }}
        >
          {t("common.refresh")}
        </Button>
      </div>
      <div className="panel telemetry-panel">
        <Tabs
          items={[
            {
              key: "installations",
              label: t("telemetry.installationsTab"),
              children: (
                <>
                  {filterBar(
                    installationFilters,
                    onInstallationFiltersChange,
                    onLoadInstallations,
                    installations.total,
                    "telemetry.installationsTotal",
                  )}
                  <Table
                    rowKey="deviceId"
                    loading={installationsLoading}
                    columns={installationColumns}
                    dataSource={installations.items}
                    pagination={{
                      current: installations.page,
                      pageSize: installations.pageSize,
                      total: installations.total,
                      showSizeChanger: true,
                    }}
                    onChange={(pagination) => onLoadInstallations(pagination.current, pagination.pageSize)}
                    scroll={{ x: 890 }}
                  />
                </>
              ),
            },
            {
              key: "events",
              label: t("telemetry.eventsTab"),
              children: (
                <>
                  {filterBar(
                    eventFilters,
                    onEventFiltersChange,
                    onLoadEvents,
                    events.total,
                    "telemetry.eventsTotal",
                  )}
                  <Table
                    rowKey="id"
                    loading={eventsLoading}
                    columns={eventColumns}
                    dataSource={events.items}
                    pagination={{
                      current: events.page,
                      pageSize: events.pageSize,
                      total: events.total,
                      showSizeChanger: true,
                    }}
                    onChange={(pagination) => onLoadEvents(pagination.current, pagination.pageSize)}
                    scroll={{ x: 980 }}
                  />
                </>
              ),
            },
          ]}
        />
      </div>
    </>
  );
}
