import { useEffect, useState } from "react";
import { App as AntApp, Form, Input, Modal } from "antd";
import { useI18n } from "../../i18n-context";
import type { ApiClient, SystemAccount } from "../../types";

interface SystemAccountModalProps {
  open: boolean;
  account: SystemAccount | null;
  api: ApiClient;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

interface FormValues {
  authJson?: string;
  note?: string;
  expiresAt?: string;
}

export function SystemAccountModal({ account, api, onClose, onSaved, open }: SystemAccountModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      authJson: "",
      note: account?.note ?? "",
      expiresAt: account?.expiresAt ?? "",
    });
  }, [account, form, open]);

  async function save(values: FormValues) {
    const body: Record<string, unknown> = {
      note: values.note ?? "",
      expiresAt: values.expiresAt ?? "",
    };
    if (values.authJson?.trim()) {
      try {
        const auth = JSON.parse(values.authJson);
        if (!auth || typeof auth !== "object" || Array.isArray(auth)) throw new Error();
        body.auth = auth;
      } catch {
        message.error(t("officialAccounts.invalidAuthJson"));
        return;
      }
    } else if (!account) {
      message.error(t("officialAccounts.authRequired"));
      return;
    }
    setSaving(true);
    try {
      await api(account ? `/admin/api/official-accounts/${account.id}` : "/admin/api/official-accounts", {
        method: account ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      message.success(t(account ? "common.updated" : "common.created"));
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
      title={t(account ? "officialAccounts.editTitle" : "officialAccounts.createTitle")}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saving}
      destroyOnClose
      width={680}
    >
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item
          name="authJson"
          label={t("officialAccounts.authJson")}
          extra={account ? t("officialAccounts.authJsonEditHint") : t("officialAccounts.authJsonHint")}
        >
          <Input.TextArea rows={10} autoComplete="off" placeholder={'{"tokens":{"access_token":"..."}}'} />
        </Form.Item>
        <Form.Item name="note" label={t("common.note")}>
          <Input maxLength={1000} />
        </Form.Item>
        <Form.Item name="expiresAt" label={t("common.expiresAt")}>
          <Input maxLength={40} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
