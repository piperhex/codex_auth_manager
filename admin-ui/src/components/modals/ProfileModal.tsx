import { Modal, Space, Tag, Typography } from "antd";
import type { Profile } from "../../types";

interface ProfileModalProps {
  open: boolean;
  profile: Profile | null;
  onClose: () => void;
}

export function ProfileModal({ onClose, open, profile }: ProfileModalProps) {
  return (
    <Modal title="用户信息" open={open} footer={null} onCancel={onClose}>
      <Space direction="vertical" size={10}>
        <Typography.Text copyable>{profile?.id}</Typography.Text>
        <Typography.Text>{profile?.email}</Typography.Text>
        <Tag color="blue">{profile?.role}</Tag>
      </Space>
    </Modal>
  );
}
