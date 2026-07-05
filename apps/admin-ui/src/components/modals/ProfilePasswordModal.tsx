import { App as AntApp, Form, Input, Modal } from "antd";
import { useI18n } from "../../i18n-context";
import type { ApiClient } from "../../types";

interface ProfilePasswordModalProps {
  open: boolean;
  api: ApiClient;
  onClose: () => void;
}

export function ProfilePasswordModal({ api, onClose, open }: ProfilePasswordModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [form] = Form.useForm();

  return (
    <Modal
      title={t("profilePassword.title")}
      open={open}
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
        onFinish={async (values: { currentPassword: string; newPassword: string }) => {
          await api("/admin/api/profile/password", {
            method: "PATCH",
            body: JSON.stringify(values),
          });
          message.success(t("common.changed"));
          onClose();
          form.resetFields();
        }}
      >
        <Form.Item name="currentPassword" label={t("profilePassword.currentPassword")} rules={[{ required: true, min: 6 }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item name="newPassword" label={t("profilePassword.newPassword")} rules={[{ required: true, min: 8 }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
