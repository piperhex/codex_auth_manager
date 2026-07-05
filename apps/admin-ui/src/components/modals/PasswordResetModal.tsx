import { App as AntApp, Form, Input, Modal, Typography } from "antd";
import { useI18n } from "../../i18n-context";
import type { ApiClient, UserRow } from "../../types";

interface PasswordResetModalProps {
  user: UserRow | null;
  api: ApiClient;
  onClose: () => void;
}

export function PasswordResetModal({ api, onClose, user }: PasswordResetModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [form] = Form.useForm();

  return (
    <Modal
      title={t("passwordReset.title")}
      open={Boolean(user)}
      onCancel={() => {
        onClose();
        form.resetFields();
      }}
      onOk={() => form.submit()}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values: { password: string }) => {
          if (!user) return;
          await api(`/admin/api/users/${user.id}`, {
            method: "PATCH",
            body: JSON.stringify({ password: values.password }),
          });
          message.success(t("common.reset"));
          onClose();
          form.resetFields();
        }}
      >
        <Typography.Paragraph>{user?.email}</Typography.Paragraph>
        <Form.Item name="password" label={t("passwordReset.newPassword")} rules={[{ required: true, min: 8 }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
