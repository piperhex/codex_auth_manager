import { useEffect } from "react";
import { App as AntApp, Form, Input, Modal, Select } from "antd";
import type { ApiClient, UserRow } from "../../types";

interface ApprovalModalProps {
  open: boolean;
  users: UserRow[];
  currentUsers: UserRow[];
  targetUserId?: string | null;
  api: ApiClient;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function ApprovalModal({
  api,
  currentUsers,
  onClose,
  onSaved,
  open,
  targetUserId,
  users,
}: ApprovalModalProps) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();

  const options = [...users, ...currentUsers]
    .filter((item, index, array) => item.role === "user"
      && array.findIndex((candidate) => candidate.id === item.id) === index)
    .map((item) => ({ label: item.email, value: item.id }));

  useEffect(() => {
    if (open) form.setFieldsValue({ targetUserId, type: "promote_user_to_admin" });
  }, [form, open, targetUserId]);

  return (
    <Modal
      title="提交管理员审批"
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
        initialValues={{ type: "promote_user_to_admin" }}
        onFinish={async (values: { type: "promote_user_to_admin"; targetUserId: string; comment?: string }) => {
          await api("/admin/api/approvals", {
            method: "POST",
            body: JSON.stringify(values),
          });
          message.success("已提交");
          onClose();
          form.resetFields();
          await onSaved();
        }}
      >
        <Form.Item name="targetUserId" label="目标用户" rules={[{ required: true }]}>
          <Select showSearch options={options} />
        </Form.Item>
        <Form.Item name="comment" label="备注">
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
