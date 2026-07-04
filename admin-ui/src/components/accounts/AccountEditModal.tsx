import { useEffect } from "react";
import { App as AntApp, Form, Input, Modal, Switch } from "antd";
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
  const [form] = Form.useForm();

  useEffect(() => {
    if (account) form.setFieldsValue(account);
    else form.resetFields();
  }, [account, form]);

  return (
    <Modal
      title="编辑同步账号"
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
          message.success("已更新");
          onClose();
          await onSaved(user);
        }}
      >
        <Form.Item name="email" label="邮箱" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="note" label="备注">
          <Input />
        </Form.Item>
        <Form.Item name="plan" label="套餐" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="expiresAt" label="到期时间">
          <Input />
        </Form.Item>
        <Form.Item name="accountId" label="Provider Account ID">
          <Input />
        </Form.Item>
        <Form.Item name="active" label="当前账号" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
