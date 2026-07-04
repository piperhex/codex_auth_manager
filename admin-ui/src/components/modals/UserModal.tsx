import { useEffect } from "react";
import { App as AntApp, Form, Input, Modal, Select, Switch } from "antd";
import type { ApiClient, Role, UserRow } from "../../types";

interface UserModalProps {
  open: boolean;
  editingUser: UserRow | null;
  api: ApiClient;
  currentPage: number;
  onClose: () => void;
  onSaved: (page?: number) => void | Promise<void>;
}

export function UserModal({ api, currentPage, editingUser, open, onClose, onSaved }: UserModalProps) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();

  useEffect(() => {
    if (open) {
      form.setFieldsValue(editingUser
        ? { email: editingUser.email, role: editingUser.role, disabled: editingUser.disabled }
        : { role: "user", disabled: false });
    } else {
      form.resetFields();
    }
  }, [editingUser, form, open]);

  return (
    <Modal
      title={editingUser ? "编辑用户" : "新建用户"}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={async (values: { email: string; password?: string; role: Role; disabled: boolean }) => {
          if (editingUser) {
            await api(`/admin/api/users/${editingUser.id}`, {
              method: "PATCH",
              body: JSON.stringify(values),
            });
            message.success("已更新");
          } else {
            await api("/admin/api/users", {
              method: "POST",
              body: JSON.stringify(values),
            });
            message.success("已创建");
          }
          onClose();
          await onSaved(editingUser ? currentPage : 1);
        }}
      >
        <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email" }]}>
          <Input autoComplete="email" />
        </Form.Item>
        {!editingUser && (
          <Form.Item name="password" label="密码" rules={[{ required: true, min: 8 }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        )}
        <Form.Item name="role" label="角色" rules={[{ required: true }]}>
          <Select options={[{ label: "user", value: "user" }, { label: "admin", value: "admin" }]} />
        </Form.Item>
        <Form.Item name="disabled" label="禁用" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
