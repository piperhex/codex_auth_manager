import { useEffect, useState } from "react";
import { Button, ColorPicker, Form, Input, InputNumber, Space, Switch, Typography } from "antd";
import { BellRing, RefreshCw, Save } from "lucide-react";
import { useI18n } from "../i18n-context";
import type { AnnouncementConfig } from "../types";
import { formatDate } from "../utils/format";

interface AnnouncementPageProps {
  announcement: AnnouncementConfig;
  loading: boolean;
  saving: boolean;
  onRefresh: () => void | Promise<void>;
  onSave: (announcement: Pick<
    AnnouncementConfig,
    "content" | "enabled" | "textColor" | "backgroundColor" | "scrollDurationSeconds"
  >) => Promise<void>;
}

export function AnnouncementPage({
  announcement,
  loading,
  saving,
  onRefresh,
  onSave,
}: AnnouncementPageProps) {
  const { language, t } = useI18n();
  const [content, setContent] = useState(announcement.content);
  const [enabled, setEnabled] = useState(announcement.enabled);
  const [textColor, setTextColor] = useState(announcement.textColor);
  const [backgroundColor, setBackgroundColor] = useState(announcement.backgroundColor);
  const [scrollDurationSeconds, setScrollDurationSeconds] = useState(
    announcement.scrollDurationSeconds,
  );

  useEffect(() => {
    setContent(announcement.content);
    setEnabled(announcement.enabled);
    setTextColor(announcement.textColor);
    setBackgroundColor(announcement.backgroundColor);
    setScrollDurationSeconds(announcement.scrollDurationSeconds);
  }, [announcement]);

  const preview = content.trim() || t("announcement.emptyPreview");

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
      <div className="panel announcement-config-panel">
        <Form layout="vertical" onFinish={() => void onSave({
          content: content.trim(),
          enabled,
          textColor,
          backgroundColor,
          scrollDurationSeconds,
        })}>
          <Form.Item label={t("announcement.enabled")} extra={t("announcement.enabledHint")}>
            <Switch checked={enabled} onChange={setEnabled} />
          </Form.Item>
          <Form.Item label={t("announcement.content")}>
            <Input.TextArea
              value={content}
              rows={5}
              maxLength={1000}
              showCount
              placeholder={t("announcement.contentPlaceholder")}
              onChange={(event) => setContent(event.target.value)}
            />
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item label={t("announcement.textColor")}>
              <ColorPicker
                value={textColor}
                showText
                onChange={(color) => setTextColor(color.toHexString().toUpperCase())}
              />
            </Form.Item>
            <Form.Item label={t("announcement.backgroundColor")}>
              <ColorPicker
                value={backgroundColor}
                showText
                onChange={(color) => setBackgroundColor(color.toHexString().toUpperCase())}
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
              />
            </Form.Item>
          </Space>
          <Form.Item label={t("announcement.preview")}>
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
          <Space>
            <Button
              type="primary"
              htmlType="submit"
              loading={saving}
              disabled={enabled && !content.trim()}
              icon={<Save size={15} />}
            >
              {t("announcement.save")}
            </Button>
          </Space>
        </Form>
      </div>
    </>
  );
}
