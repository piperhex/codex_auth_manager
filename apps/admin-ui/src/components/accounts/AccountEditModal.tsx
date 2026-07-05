import { useEffect } from "react";
import { App as AntApp, Form, Input, Modal, Switch } from "antd";
import { useI18n } from "../../i18n-context";
import type { ApiClient, SyncAccount, UserRow } from "../../types";

interface AccountEditModalProps {
  user: UserRow | null;
  account: SyncAccount | null;
  api: ApiClient;
  onClose: () => void;
  onSaved: (user: UserRow) => void | Promise<void>;
}

export function AccountEditModal({ account, api, onClose, onSaved, user }: AccountEditModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [form] = Form.useForm();

  useEffect(() => {
    if (account) form.setFieldsValue(account);
    else form.resetFields();
  }, [account, form]);

  return (
    <Modal
      title={t("accounts.editTitle")}
      open={Boolean(account)}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values: Partial<SyncAccount>) => {
          if (!user || !account) return;
          await api(`/admin/api/users/${user.id}/accounts/${account.id}`, {
            method: "PATCH",
            body: JSON.stringify(values),
          });
          message.success(t("common.updated"));
          onClose();
          await onSaved(user);
        }}
      >
        <Form.Item name="email" label={t("common.email")} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="note" label={t("common.note")}>
          <Input />
        </Form.Item>
        <Form.Item name="plan" label={t("common.plan")} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="expiresAt" label={t("common.expiresAt")}>
          <Input />
        </Form.Item>
        <Form.Item name="accountId" label={t("accounts.providerAccountId")}>
          <Input />
        </Form.Item>
        <Form.Item name="active" label={t("accounts.currentAccount")} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
