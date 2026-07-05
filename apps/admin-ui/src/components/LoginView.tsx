import { useEffect, useMemo, useState } from "react";
import { App as AntApp, Button, Card, Form, Input, Segmented, Space } from "antd";
import { Languages } from "lucide-react";
import { LANGUAGE_OPTIONS, type Language } from "../i18n";
import { useI18n } from "../i18n-context";
import type { AuthTokens } from "../types";

interface LoginViewProps {
  onAuth: (tokens: AuthTokens) => void;
}

export function LoginView({ onAuth }: LoginViewProps) {
  const { message } = AntApp.useApp();
  const { language, setLanguage, t } = useI18n();
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
          <div className="login-brand-row">
            <div>
              <h1>Codex Switch Admin</h1>
              <span>{t("login.subtitle")}</span>
            </div>
            <div className="language-control" aria-label={t("language.label")}>
              <Languages size={15} />
              <Segmented
                size="small"
                value={language}
                options={[...LANGUAGE_OPTIONS]}
                onChange={(value) => setLanguage(value as Language)}
              />
            </div>
          </div>
        </div>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ inviteToken }}
          onFinish={(values) => submit("/auth/login", values)}
        >
          <Form.Item name="email" label={t("common.email")} rules={[{ required: true, type: "email" }]}>
            <Input autoComplete="email" />
          </Form.Item>
          <Form.Item name="password" label={t("common.password")} rules={[{ required: true, min: 6 }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="inviteToken" label={t("login.inviteToken")}>
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
              {t("login.register")}
            </Button>
            <Button type="primary" htmlType="submit" loading={loading}>{t("login.submit")}</Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
