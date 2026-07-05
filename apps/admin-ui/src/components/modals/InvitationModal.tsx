import { useState } from "react";
import { App as AntApp, Button, Form, Input, InputNumber, Modal, Select } from "antd";
import { ClipboardCopy } from "lucide-react";
import { labelForRole } from "../../i18n";
import { useI18n } from "../../i18n-context";
import type { ApiClient, Invitation, Role } from "../../types";

interface InvitationModalProps {
  open: boolean;
  api: ApiClient;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function InvitationModal({ api, onClose, onSaved, open }: InvitationModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [form] = Form.useForm();
  const [createdInvite, setCreatedInvite] = useState<string | null>(null);

  const close = () => {
    onClose();
    setCreatedInvite(null);
    form.resetFields();
  };

  return (
    <Modal
      title={t("invitationModal.title")}
      open={open}
      onCancel={close}
      onOk={() => form.submit()}
      destroyOnClose
    >
      {createdInvite && (
        <div className="token-box">
          <code>{`${window.location.origin}/admin?inviteToken=${createdInvite}`}</code>
          <Button
            icon={<ClipboardCopy size={15} />}
            onClick={async () => {
              await navigator.clipboard.writeText(`${window.location.origin}/admin?inviteToken=${createdInvite}`);
              message.success(t("common.copied"));
            }}
          />
        </div>
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ role: "user", expiresInHours: 72 }}
        onFinish={async (values: { email: string; role: Role; expiresInHours: number }) => {
          const invitation = await api<Invitation>("/admin/api/invitations", {
            method: "POST",
            body: JSON.stringify(values),
          });
          setCreatedInvite(invitation.token ?? null);
          message.success(t("common.created"));
          await onSaved();
        }}
      >
        <Form.Item name="email" label={t("common.email")} rules={[{ required: true, type: "email" }]}>
          <Input />
        </Form.Item>
        <Form.Item name="role" label={t("common.role")} rules={[{ required: true }]}>
          <Select options={[{ label: labelForRole("user", t), value: "user" }, { label: labelForRole("admin", t), value: "admin" }]} />
        </Form.Item>
        <Form.Item name="expiresInHours" label={t("invitations.validHours")} rules={[{ required: true }]}>
          <InputNumber min={1} max={720} style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
