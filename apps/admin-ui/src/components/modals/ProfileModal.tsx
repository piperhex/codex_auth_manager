import { Modal, Space, Tag, Typography } from "antd";
import { labelForRole } from "../../i18n";
import { useI18n } from "../../i18n-context";
import type { Profile } from "../../types";

interface ProfileModalProps {
  open: boolean;
  profile: Profile | null;
  onClose: () => void;
}

export function ProfileModal({ onClose, open, profile }: ProfileModalProps) {
  const { t } = useI18n();

  return (
    <Modal title={t("profile.title")} open={open} footer={null} onCancel={onClose}>
      <Space direction="vertical" size={10}>
        <Typography.Text copyable>{profile?.id}</Typography.Text>
        <Typography.Text>{profile?.email}</Typography.Text>
        {profile?.role && <Tag color="blue">{labelForRole(profile.role, t)}</Tag>}
      </Space>
    </Modal>
  );
}
