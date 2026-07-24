import { useEffect, useRef, useState } from "react";
import {
  App,
  Button,
  ColorPicker,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { BellRing, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useI18n } from "../i18n-context";
import type {
  AnnouncementClick,
  AnnouncementClickFilters,
  AnnouncementClickOverview,
  AnnouncementConfig,
  AppNotification,
  AppNotificationInput,
  PageResult,
  TelemetryPlatform,
} from "../types";
import { formatDate } from "../utils/format";

type EditableAnnouncement = Pick<
  AnnouncementConfig,
  "contentZh" | "contentEn" | "link" | "enabled" | "textColor"
  | "backgroundColor" | "scrollDurationSeconds"
>;

function announcementsMatch(left: EditableAnnouncement, right: EditableAnnouncement) {
  return left.contentZh === right.contentZh
    && left.contentEn === right.contentEn
    && left.link === right.link
    && left.enabled === right.enabled
    && left.textColor === right.textColor
    && left.backgroundColor === right.backgroundColor
    && left.scrollDurationSeconds === right.scrollDurationSeconds;
}

function editableAnnouncement(announcement: EditableAnnouncement): EditableAnnouncement {
  return {
    contentZh: announcement.contentZh.trim(),
    contentEn: announcement.contentEn.trim(),
    link: announcement.link.trim(),
    enabled: announcement.enabled,
    textColor: announcement.textColor,
    backgroundColor: announcement.backgroundColor,
    scrollDurationSeconds: announcement.scrollDurationSeconds,
  };
}

function isValidAnnouncementLink(link: string) {
  if (!link) return true;
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

interface AnnouncementPageProps {
  announcement: AnnouncementConfig;
  notifications: AppNotification[];
  loading: boolean;
  notificationsLoading: boolean;
  saving: boolean;
  notificationSaving: boolean;
  clickOverview: AnnouncementClickOverview;
  clicks: PageResult<AnnouncementClick>;
  clickOverviewLoading: boolean;
  clicksLoading: boolean;
  clickFilters: AnnouncementClickFilters;
  onClickFiltersChange: (filters: AnnouncementClickFilters) => void;
  onLoadClicks: (page?: number, pageSize?: number) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onSave: (announcement: Pick<
    AnnouncementConfig,
    "contentZh" | "contentEn" | "link" | "enabled" | "textColor"
    | "backgroundColor" | "scrollDurationSeconds"
  >) => Promise<void>;
  onSaveNotification: (id: string | null, notification: AppNotificationInput) => Promise<void>;
  onDeleteNotification: (id: string) => Promise<void>;
  canManage: boolean;
}

type NotificationFormValues = Omit<AppNotificationInput, "publishedAt"> & {
  publishedAt: Dayjs;
};

const platforms: TelemetryPlatform[] = ["windows", "macos", "linux", "android", "ios"];

const platformColors: Record<TelemetryPlatform, string> = {
  windows: "blue",
  macos: "purple",
  linux: "orange",
  android: "green",
  ios: "cyan",
};

export function AnnouncementPage({
  announcement,
  notifications,
  loading,
  notificationsLoading,
  saving,
  notificationSaving,
  clickOverview,
  clicks,
  clickOverviewLoading,
  clicksLoading,
  clickFilters,
  onClickFiltersChange,
  onLoadClicks,
  onRefresh,
  onSave,
  onSaveNotification,
  onDeleteNotification,
  canManage,
}: AnnouncementPageProps) {
  const { message } = App.useApp();
  const { language, t } = useI18n();
  const [contentZh, setContentZh] = useState(announcement.contentZh);
  const [contentEn, setContentEn] = useState(announcement.contentEn);
  const [link, setLink] = useState(announcement.link);
  const [enabled, setEnabled] = useState(announcement.enabled);
  const [textColor, setTextColor] = useState(announcement.textColor);
  const [backgroundColor, setBackgroundColor] = useState(announcement.backgroundColor);
  const [scrollDurationSeconds, setScrollDurationSeconds] = useState(
    announcement.scrollDurationSeconds,
  );
  const [notificationModalOpen, setNotificationModalOpen] = useState(false);
  const [editingNotification, setEditingNotification] = useState<AppNotification | null>(null);
  const [notificationForm] = Form.useForm<NotificationFormValues>();
  const lastSubmitted = useRef<EditableAnnouncement>(editableAnnouncement(announcement));
  const pendingSaves = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (pendingSaves.current > 0) return;
    setContentZh(announcement.contentZh);
    setContentEn(announcement.contentEn);
    setLink(announcement.link);
    setEnabled(announcement.enabled);
    setTextColor(announcement.textColor);
    setBackgroundColor(announcement.backgroundColor);
    setScrollDurationSeconds(announcement.scrollDurationSeconds);
    lastSubmitted.current = editableAnnouncement(announcement);
  }, [announcement]);

  const previewContent = language === "zh" ? contentZh : contentEn;
  const preview = previewContent.trim() || t("announcement.emptyPreview");
  const normalizedLink = link.trim();
  const linkIsValid = isValidAnnouncementLink(normalizedLink);
  const platformOptions = platforms.map((platform) => ({
    value: platform,
    label: t(`telemetry.platform.${platform}`),
  }));
  const clickColumns: TableColumnsType<AnnouncementClick> = [
    {
      title: t("announcement.clickTime"),
      dataIndex: "createdAt",
      width: 190,
      render: (value: string) => formatDate(value, language),
    },
    {
      title: t("announcement.clickEmail"),
      dataIndex: "email",
      width: 240,
      render: (value?: string | null) => value || t("announcement.clickAnonymous"),
    },
    {
      title: t("announcement.clickPlatform"),
      dataIndex: "platform",
      width: 130,
      render: (platform: TelemetryPlatform) => (
        <Tag color={platformColors[platform]}>{t(`telemetry.platform.${platform}`)}</Tag>
      ),
    },
    {
      title: t("announcement.clickDeviceId"),
      dataIndex: "deviceId",
      render: (value: string) => <Typography.Text code copyable>{value}</Typography.Text>,
    },
  ];
  const notificationColumns: TableColumnsType<AppNotification> = [
    {
      title: t("notification.titleColumn"),
      key: "title",
      render: (_, row) => language === "zh" ? row.titleZh : row.titleEn,
    },
    {
      title: t("notification.publishedAt"),
      dataIndex: "publishedAt",
      width: 190,
      render: (value: string) => formatDate(value, language),
    },
    {
      title: t("notification.status"),
      dataIndex: "enabled",
      width: 100,
      render: (value: boolean) => (
        <Tag color={value ? "green" : "default"}>
          {t(value ? "notification.enabled" : "notification.disabled")}
        </Tag>
      ),
    },
    {
      title: t("notification.link"),
      dataIndex: "link",
      width: 120,
      render: (value: string) => value
        ? <Tag color="blue">{t("notification.hasLink")}</Tag>
        : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 150,
      render: (_, row) => (
        <Space>
          <Button
            size="small"
            icon={<Pencil size={14} />}
            disabled={!canManage}
            onClick={() => {
              setEditingNotification(row);
              notificationForm.setFieldsValue({
                titleZh: row.titleZh,
                titleEn: row.titleEn,
                contentZh: row.contentZh,
                contentEn: row.contentEn,
                link: row.link,
                linkLabelZh: row.linkLabelZh,
                linkLabelEn: row.linkLabelEn,
                enabled: row.enabled,
                publishedAt: dayjs(row.publishedAt),
              });
              setNotificationModalOpen(true);
            }}
          >
            {t("common.edit")}
          </Button>
          <Popconfirm
            title={t("notification.deleteConfirm")}
            okText={t("common.delete")}
            cancelText={t("common.cancel")}
            disabled={!canManage}
            onConfirm={() => onDeleteNotification(row.id)}
          >
            <Button size="small" danger icon={<Trash2 size={14} />} disabled={!canManage} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const autoSave = (overrides: Partial<EditableAnnouncement> = {}) => {
    const next = editableAnnouncement({
      contentZh,
      contentEn,
      link,
      enabled,
      textColor,
      backgroundColor,
      scrollDurationSeconds,
      ...overrides,
    });

    if (!isValidAnnouncementLink(next.link)) {
      message.error(t("announcement.linkInvalid"));
      return false;
    }
    if (next.enabled && (!next.contentZh || !next.contentEn)) {
      message.error(t("announcement.enabledHint"));
      return false;
    }
    if (announcementsMatch(next, lastSubmitted.current)) return true;

    const previous = lastSubmitted.current;
    lastSubmitted.current = next;
    pendingSaves.current += 1;
    const queuedSave = saveQueue.current.then(() => onSave(next));
    saveQueue.current = queuedSave.catch(() => undefined);
    void queuedSave.catch(() => {
      if (announcementsMatch(next, lastSubmitted.current)) {
        lastSubmitted.current = previous;
      }
    }).finally(() => {
      pendingSaves.current -= 1;
    });
    return true;
  };

  return (
    <>
      <h1 className="page-title">{t("announcement.title")}</h1>
      <Typography.Paragraph type="secondary">{t("announcement.description")}</Typography.Paragraph>
      <div className="toolbar">
        <div className="toolbar-left">
          {announcement.updatedAt && (
            <Typography.Text type="secondary">
              {t("announcement.updatedAt", { time: formatDate(announcement.updatedAt, language) })}
            </Typography.Text>
          )}
        </div>
        <div className="toolbar-right">
          <Button
            loading={loading || clickOverviewLoading || clicksLoading}
            icon={<RefreshCw size={15} />}
            onClick={() => void onRefresh()}
          >
            {t("common.refresh")}
          </Button>
        </div>
      </div>
      <Tabs
        items={[
          {
            key: "notifications",
            label: t("notification.tab"),
            children: (
              <>
                <Typography.Paragraph type="secondary">
                  {t("notification.description")}
                </Typography.Paragraph>
                <div className="toolbar">
                  <div className="toolbar-left">
                    <Typography.Text type="secondary">
                      {t("notification.pollingHint")}
                    </Typography.Text>
                  </div>
                  <div className="toolbar-right">
                    <Button
                      type="primary"
                      icon={<Plus size={15} />}
                      disabled={!canManage}
                      onClick={() => {
                        setEditingNotification(null);
                        notificationForm.resetFields();
                        notificationForm.setFieldsValue({
                          titleZh: "",
                          titleEn: "",
                          contentZh: "",
                          contentEn: "",
                          link: "",
                          linkLabelZh: "",
                          linkLabelEn: "",
                          enabled: true,
                          publishedAt: dayjs(),
                        });
                        setNotificationModalOpen(true);
                      }}
                    >
                      {t("notification.create")}
                    </Button>
                  </div>
                </div>
                <div className="panel telemetry-panel">
                  <Table
                    rowKey="id"
                    loading={notificationsLoading || notificationSaving}
                    columns={notificationColumns}
                    dataSource={notifications}
                    pagination={{ pageSize: 10, showSizeChanger: true }}
                    scroll={{ x: 860 }}
                  />
                </div>
              </>
            ),
          },
          {
            key: "settings",
            label: t("announcement.settingsTab"),
            children: (
              <div className="panel announcement-config-panel" aria-busy={saving}>
                <Form layout="vertical">
                  <Form.Item label={t("announcement.enabled")} extra={t("announcement.enabledHint")}>
                    <Switch
                      disabled={!canManage}
                      checked={enabled}
                      onChange={(checked) => {
                        if (autoSave({ enabled: checked })) setEnabled(checked);
                      }}
                    />
                  </Form.Item>
                  <Form.Item label={t("announcement.contentZh")}>
                    <Input.TextArea
                      value={contentZh}
                      rows={5}
                      maxLength={1000}
                      showCount
                      placeholder={t("announcement.contentZhPlaceholder")}
                      onChange={(event) => setContentZh(event.target.value)}
                      onBlur={() => autoSave()}
                      disabled={!canManage}
                    />
                  </Form.Item>
                  <Form.Item label={t("announcement.contentEn")}>
                    <Input.TextArea
                      value={contentEn}
                      rows={5}
                      maxLength={1000}
                      showCount
                      placeholder={t("announcement.contentEnPlaceholder")}
                      onChange={(event) => setContentEn(event.target.value)}
                      onBlur={() => autoSave()}
                      disabled={!canManage}
                    />
                  </Form.Item>
                  <Form.Item
                    label={t("announcement.link")}
                    extra={linkIsValid ? t("announcement.linkHint") : undefined}
                    validateStatus={linkIsValid ? undefined : "error"}
                    help={linkIsValid ? undefined : t("announcement.linkInvalid")}
                  >
                    <Input
                      value={link}
                      maxLength={2048}
                      placeholder={t("announcement.linkPlaceholder")}
                      onChange={(event) => setLink(event.target.value)}
                      onBlur={() => autoSave()}
                      disabled={!canManage}
                      allowClear
                    />
                  </Form.Item>
                  <Space size="large" wrap>
                    <Form.Item label={t("announcement.textColor")}>
                      <ColorPicker
                        value={textColor}
                        showText
                        onChange={(color) => setTextColor(color.toHexString().toUpperCase())}
                        onOpenChange={(open) => {
                          if (!open) autoSave();
                        }}
                        disabled={!canManage}
                      />
                    </Form.Item>
                    <Form.Item label={t("announcement.backgroundColor")}>
                      <ColorPicker
                        value={backgroundColor}
                        showText
                        onChange={(color) => setBackgroundColor(color.toHexString().toUpperCase())}
                        onOpenChange={(open) => {
                          if (!open) autoSave();
                        }}
                        disabled={!canManage}
                      />
                    </Form.Item>
                    <Form.Item
                      label={t("announcement.scrollSpeed")}
                      extra={t("announcement.scrollSpeedHint")}
                    >
                      <InputNumber
                        min={5}
                        max={120}
                        precision={0}
                        value={scrollDurationSeconds}
                        addonAfter={t("announcement.secondsPerLoop")}
                        onChange={(value) => setScrollDurationSeconds(value ?? 22)}
                        onBlur={() => autoSave()}
                        disabled={!canManage}
                      />
                    </Form.Item>
                  </Space>
                  <Form.Item
                    label={t("announcement.preview")}
                    extra={t("announcement.previewLanguageHint")}
                  >
                    <div className="announcement-preview" style={{ color: textColor, backgroundColor }}>
                      <div
                        className="announcement-preview-track"
                        key={preview}
                        style={{ animationDuration: `${scrollDurationSeconds}s` }}
                      >
                        <BellRing size={15} />
                        <span>{preview}</span>
                      </div>
                    </div>
                  </Form.Item>
                </Form>
              </div>
            ),
          },
          {
            key: "clickAnalytics",
            label: t("announcement.clickAnalytics"),
            children: (
              <>
                <Typography.Paragraph type="secondary">
                  {t("announcement.clickAnalyticsDescription")}
                </Typography.Paragraph>
                <div className="summary-grid announcement-click-summary">
                  <div className="metric">
                    <span>{t("announcement.totalClicks")}</span>
                    <strong>{clickOverview.totalClicks}</strong>
                  </div>
                  <div className="metric">
                    <span>{t("announcement.clicksLast30Days")}</span>
                    <strong>{clickOverview.clicksLast30Days}</strong>
                  </div>
                </div>
                <div className="toolbar">
                  <Space wrap>
                    <Typography.Text type="secondary">
                      {t("announcement.clickPlatformDistribution")}
                    </Typography.Text>
                    {platforms.map((platform) => (
                      <Tag key={platform}>
                        {t(`telemetry.platform.${platform}`)}: {clickOverview.platforms[platform]}
                      </Tag>
                    ))}
                  </Space>
                </div>
                <div className="panel telemetry-panel">
                  <div className="toolbar telemetry-table-toolbar">
                    <div className="toolbar-left">
                      <Input
                        allowClear
                        prefix={<Search size={15} />}
                        placeholder={t("announcement.clickSearchPlaceholder")}
                        value={clickFilters.search}
                        onChange={(event) => onClickFiltersChange({
                          ...clickFilters,
                          search: event.target.value,
                        })}
                        onPressEnter={() => onLoadClicks(1)}
                        style={{ width: 320 }}
                      />
                      <Select
                        allowClear
                        placeholder={t("announcement.clickPlatform")}
                        value={clickFilters.platform}
                        options={platformOptions}
                        onChange={(platform) => onClickFiltersChange({ ...clickFilters, platform })}
                        style={{ width: 150 }}
                      />
                      <Button icon={<Search size={15} />} onClick={() => onLoadClicks(1)}>
                        {t("common.filter")}
                      </Button>
                    </div>
                    <Typography.Text type="secondary">
                      {t("announcement.clickRecordsTotal", { count: clicks.total })}
                    </Typography.Text>
                  </div>
                  <Table
                    rowKey="id"
                    loading={clickOverviewLoading || clicksLoading}
                    columns={clickColumns}
                    dataSource={clicks.items}
                    pagination={{
                      current: clicks.page,
                      pageSize: clicks.pageSize,
                      total: clicks.total,
                      showSizeChanger: true,
                    }}
                    onChange={(pagination) => onLoadClicks(pagination.current, pagination.pageSize)}
                    scroll={{ x: 920 }}
                  />
                </div>
              </>
            ),
          },
        ]}
      />
      <Modal
        open={notificationModalOpen}
        title={t(editingNotification ? "notification.edit" : "notification.create")}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        confirmLoading={notificationSaving}
        destroyOnClose
        onCancel={() => setNotificationModalOpen(false)}
        onOk={() => notificationForm.submit()}
      >
        <Form<NotificationFormValues>
          form={notificationForm}
          layout="vertical"
          preserve={false}
          onFinish={async (values) => {
            await onSaveNotification(editingNotification?.id ?? null, {
              ...values,
              titleZh: values.titleZh.trim(),
              titleEn: values.titleEn.trim(),
              contentZh: values.contentZh.trim(),
              contentEn: values.contentEn.trim(),
              link: values.link.trim(),
              linkLabelZh: values.linkLabelZh.trim(),
              linkLabelEn: values.linkLabelEn.trim(),
              publishedAt: values.publishedAt.toISOString(),
            });
            setNotificationModalOpen(false);
          }}
        >
          <Form.Item name="enabled" label={t("notification.publish")} valuePropName="checked">
            <Switch />
          </Form.Item>
          <Space align="start" size="middle" className="notification-form-row">
            <Form.Item
              name="titleZh"
              label={t("notification.titleZh")}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={160} showCount />
            </Form.Item>
            <Form.Item
              name="titleEn"
              label={t("notification.titleEn")}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={160} showCount />
            </Form.Item>
          </Space>
          <Form.Item
            name="contentZh"
            label={t("notification.contentZh")}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea rows={4} maxLength={4000} showCount />
          </Form.Item>
          <Form.Item
            name="contentEn"
            label={t("notification.contentEn")}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea rows={4} maxLength={4000} showCount />
          </Form.Item>
          <Form.Item
            name="publishedAt"
            label={t("notification.publishedAt")}
            rules={[{ required: true }]}
          >
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="link"
            label={t("notification.link")}
            extra={t("notification.linkHint")}
            rules={[{
              validator: async (_, value: string) => {
                if (!value || isValidAnnouncementLink(value.trim())) return;
                throw new Error(t("announcement.linkInvalid"));
              },
            }]}
          >
            <Input maxLength={2048} placeholder="https://example.com/release" allowClear />
          </Form.Item>
          <Space align="start" size="middle" className="notification-form-row">
            <Form.Item name="linkLabelZh" label={t("notification.linkLabelZh")}>
              <Input maxLength={80} placeholder={t("notification.linkLabelZhPlaceholder")} />
            </Form.Item>
            <Form.Item name="linkLabelEn" label={t("notification.linkLabelEn")}>
              <Input maxLength={80} placeholder={t("notification.linkLabelEnPlaceholder")} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
