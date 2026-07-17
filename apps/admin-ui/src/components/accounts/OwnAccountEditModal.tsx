import { useEffect, useState } from "react";
import { App as AntApp, Form, Input, Modal } from "antd";
import { useI18n } from "../../i18n-context";
import type { ApiClient, SyncAccount } from "../../types";

interface OwnAccountEditModalProps {
  account: SyncAccount | null;
  api: ApiClient;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

interface FormValues {
  note?: string;
  expiresAt?: string;
}

export function OwnAccountEditModal({ account, api, onClose, onSaved }: OwnAccountEditModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!account) return;
    form.setFieldsValue({
      note: account.note ?? "",
      expiresAt: account.expiresAt ?? "",
    });
  }, [account, form]);

  async function save(values: FormValues) {
    if (!account) return;
    setSaving(true);
    try {
      await api(`/admin/api/profile/accounts/${encodeURIComponent(account.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          note: values.note ?? "",
          expiresAt: values.expiresAt ?? "",
        }),
      });
      message.success(t("common.updated"));
      onClose();
      await onSaved();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t("accounts.editMetadataTitle")}
      open={Boolean(account)}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saving}
      destroyOnClose
      width={620}
    >
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="note" label={t("common.note")}>
          <Input.TextArea rows={6} maxLength={1000} showCount />
        </Form.Item>
        <Form.Item name="expiresAt" label={t("common.expiresAt")}>
          <Input maxLength={40} placeholder="YYYY-MM-DD" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
