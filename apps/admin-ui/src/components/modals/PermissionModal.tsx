import { useEffect, useState } from "react";
import { App as AntApp, Form, Input, Modal } from "antd";
import { useI18n } from "../../i18n-context";
import type { ApiClient, PermissionDefinition } from "../../types";

interface PermissionModalProps {
  open: boolean;
  permission: PermissionDefinition | null;
  api: ApiClient;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

interface PermissionFormValues {
  code: string;
  name: string;
  group: string;
  description?: string;
}

export function PermissionModal({
  api,
  onClose,
  onSaved,
  open,
  permission,
}: PermissionModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [form] = Form.useForm<PermissionFormValues>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      form.resetFields();
      return;
    }
    form.setFieldsValue(permission
      ? {
        code: permission.code,
        name: permission.name,
        group: permission.group,
        description: permission.description,
      }
      : { code: "", name: "", group: "", description: "" });
  }, [form, open, permission]);

  return (
    <Modal
      title={t(permission ? "roles.editPermissionTitle" : "roles.createPermissionTitle")}
      open={open}
      width={640}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saving}
      destroyOnClose
    >
      <Form<PermissionFormValues>
        form={form}
        layout="vertical"
        onFinish={async (values) => {
          setSaving(true);
          try {
            const path = permission
              ? `/admin/api/permissions/${encodeURIComponent(permission.code)}`
              : "/admin/api/permissions";
            const body = permission
              ? { name: values.name, group: values.group, description: values.description }
              : values;
            await api(path, {
              method: permission ? "PATCH" : "POST",
              body: JSON.stringify(body),
            });
            message.success(t(permission ? "common.updated" : "common.created"));
            onClose();
            await onSaved();
          } finally {
            setSaving(false);
          }
        }}
      >
        <Form.Item
          name="code"
          label={t("roles.permissionCode")}
          extra={t("roles.permissionCodeHint")}
          rules={[
            { required: true, whitespace: true },
            { pattern: /^[a-z][a-z0-9.-]{1,99}$/ },
          ]}
        >
          <Input disabled={Boolean(permission)} maxLength={100} placeholder="crm.orders.read" />
        </Form.Item>
        <Form.Item name="name" label={t("common.name")} rules={[{ required: true, whitespace: true }]}>
          <Input maxLength={100} showCount />
        </Form.Item>
        <Form.Item
          name="group"
          label={t("roles.permissionGroup")}
          rules={[{ required: true, whitespace: true }]}
        >
          <Input maxLength={60} showCount placeholder="crm" />
        </Form.Item>
        <Form.Item name="description" label={t("roles.descriptionField")}>
          <Input.TextArea maxLength={500} showCount rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
