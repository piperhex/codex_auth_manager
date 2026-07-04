import { useEffect, useMemo, useState } from "react";
import { App as AntApp, Button, Card, Form, Input, Space } from "antd";
import type { AuthTokens } from "../types";

interface LoginViewProps {
  onAuth: (tokens: AuthTokens) => void;
}

export function LoginView({ onAuth }: LoginViewProps) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const inviteToken = useMemo(() => new URLSearchParams(window.location.search).get("inviteToken") ?? "", []);

  useEffect(() => {
    if (inviteToken) form.setFieldValue("inviteToken", inviteToken);
  }, [form, inviteToken]);

  async function submit(path: "/auth/login" | "/auth/register", values: {
    email: string;
    password: string;
    inviteToken?: string;
  }) {
    setLoading(true);
    try {
      const body = path === "/auth/register"
        ? values
        : { email: values.email, password: values.password };
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || response.statusText);
      onAuth(data as AuthTokens);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <Card className="login-card">
        <div className="login-brand">
          <h1>Codex Switch Admin</h1>
          <span>后台管理系统</span>
        </div>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ inviteToken }}
          onFinish={(values) => submit("/auth/login", values)}
        >
          <Form.Item name="email" label="邮箱" rules={[{ required: true, type: "email" }]}>
            <Input autoComplete="email" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, min: 6 }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="inviteToken" label="邀请 Token">
            <Input />
          </Form.Item>
          <Space style={{ width: "100%", justifyContent: "space-between" }}>
            <Button
              onClick={async () => {
                const values = await form.validateFields();
                await submit("/auth/register", values);
              }}
              disabled={loading}
            >
              注册首个/邀请账号
            </Button>
            <Button type="primary" htmlType="submit" loading={loading}>登录</Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
