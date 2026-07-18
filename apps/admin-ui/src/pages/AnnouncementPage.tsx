import { useEffect, useRef, useState } from "react";
import { App, Button, ColorPicker, Form, Input, InputNumber, Space, Switch, Typography } from "antd";
import { BellRing, RefreshCw } from "lucide-react";
import { useI18n } from "../i18n-context";
import type { AnnouncementConfig } from "../types";
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
  loading: boolean;
  saving: boolean;
  onRefresh: () => void | Promise<void>;
  onSave: (announcement: Pick<
    AnnouncementConfig,
    "contentZh" | "contentEn" | "link" | "enabled" | "textColor"
    | "backgroundColor" | "scrollDurationSeconds"
  >) => Promise<void>;
  canManage: boolean;
}

export function AnnouncementPage({
  announcement,
  loading,
  saving,
  onRefresh,
  onSave,
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
          <Button loading={loading} icon={<RefreshCw size={15} />} onClick={() => void onRefresh()}>
            {t("common.refresh")}
          </Button>
        </div>
      </div>
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
    </>
  );
}
