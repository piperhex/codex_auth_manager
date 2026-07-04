import { App as AntApp, Form, Input, Modal } from "antd";
import type { ApiClient } from "../../types";

interface ProfilePasswordModalProps {
  open: boolean;
  api: ApiClient;
  onClose: () => void;
}

export function ProfilePasswordModal({ api, onClose, open }: ProfilePasswordModalProps) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();

  return (
    <Modal
      title="修改密码"
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
          message.success("已修改");
          onClose();
          form.resetFields();
        }}
      >
        <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, min: 6 }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item name="newPassword" label="新密码" rules={[{ required: true, min: 8 }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
