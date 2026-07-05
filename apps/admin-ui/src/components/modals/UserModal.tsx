import { useEffect } from "react";
import { App as AntApp, Form, Input, Modal, Select, Switch } from "antd";
import { labelForRole } from "../../i18n";
import { useI18n } from "../../i18n-context";
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
  const { t } = useI18n();
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
      title={editingUser ? t("userModal.editTitle") : t("userModal.createTitle")}
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
            message.success(t("common.updated"));
          } else {
            await api("/admin/api/users", {
              method: "POST",
              body: JSON.stringify(values),
            });
            message.success(t("common.created"));
          }
          onClose();
          await onSaved(editingUser ? currentPage : 1);
        }}
      >
        <Form.Item name="email" label={t("common.email")} rules={[{ required: true, type: "email" }]}>
          <Input autoComplete="email" />
        </Form.Item>
        {!editingUser && (
          <Form.Item name="password" label={t("common.password")} rules={[{ required: true, min: 8 }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        )}
        <Form.Item name="role" label={t("common.role")} rules={[{ required: true }]}>
          <Select options={[{ label: labelForRole("user", t), value: "user" }, { label: labelForRole("admin", t), value: "admin" }]} />
        </Form.Item>
        <Form.Item name="disabled" label={t("userModal.disabled")} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
