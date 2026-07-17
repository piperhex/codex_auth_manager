import { useEffect, useState } from "react";
import { App as AntApp, DatePicker, Form, Input, Modal, Upload } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { FileUp } from "lucide-react";
import { useI18n } from "../../i18n-context";
import type { ApiClient, SystemAccount } from "../../types";

interface SystemAccountModalProps {
  open: boolean;
  account: SystemAccount | null;
  compatible?: boolean;
  api: ApiClient;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

interface FormValues {
  authJson?: string;
  note?: string;
  expiresAt?: Dayjs | null;
}

interface CompatibleImportResult {
  importedCount: number;
}

const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;

export function SystemAccountModal({
  account,
  api,
  compatible = false,
  onClose,
  onSaved,
  open,
}: SystemAccountModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");

  useEffect(() => {
    if (!open) return;
    const expiresAt = account?.expiresAt ? dayjs(account.expiresAt) : null;
    form.setFieldsValue({
      authJson: "",
      note: account?.note ?? "",
      expiresAt: expiresAt?.isValid() ? expiresAt : null,
    });
    setSelectedFileName("");
  }, [account, form, open]);

  async function save(values: FormValues) {
    const content = values.authJson?.trim() ?? "";
    const body: Record<string, unknown> = {
      note: values.note ?? "",
      expiresAt: values.expiresAt?.toISOString() ?? "",
    };
    if (content && !compatible) {
      try {
        const auth = JSON.parse(content.replace(/^\uFEFF/, ""));
        if (!auth || typeof auth !== "object" || Array.isArray(auth)) throw new Error();
        body.auth = auth;
      } catch {
        message.error(t("officialAccounts.invalidAuthJson"));
        return;
      }
    } else if (!content) {
      if (account) {
        delete body.auth;
      } else {
        message.error(t("officialAccounts.authRequired"));
        return;
      }
    }
    if (compatible && account) {
      message.error(t("officialAccounts.compatibleCreateOnly"));
      return;
    }
    if (!content && !account) {
      message.error(t("officialAccounts.authRequired"));
      return;
    }
    setSaving(true);
    try {
      if (compatible) {
        const result = await api<CompatibleImportResult>("/admin/api/official-accounts/import", {
          method: "POST",
          body: JSON.stringify({ ...body, content }),
        });
        message.success(t("officialAccounts.compatibleImported", { count: result.importedCount }));
      } else {
        await api(account ? `/admin/api/official-accounts/${account.id}` : "/admin/api/official-accounts", {
          method: account ? "PATCH" : "POST",
          body: JSON.stringify(body),
        });
        message.success(t(account ? "common.updated" : "common.created"));
      }
      onClose();
      await onSaved();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function selectFile(file: File) {
    if (file.size > MAX_IMPORT_FILE_SIZE) {
      message.error(t("officialAccounts.fileTooLarge"));
      return;
    }
    try {
      form.setFieldValue("authJson", await file.text());
      setSelectedFileName(file.name);
      message.success(t("officialAccounts.fileLoaded", { name: file.name }));
    } catch {
      message.error(t("officialAccounts.fileReadFailed"));
    }
  }

  return (
    <Modal
      title={t(account
        ? "officialAccounts.editTitle"
        : compatible
          ? "officialAccounts.compatibleImportTitle"
          : "officialAccounts.createTitle")}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={saving}
      destroyOnClose
      width={680}
    >
      <Form form={form} layout="vertical" onFinish={save}>
        <Upload.Dragger
          accept=".json,.jsonl,.ndjson,application/json"
          beforeUpload={(file) => {
            void selectFile(file);
            return false;
          }}
          fileList={[]}
          multiple={false}
          showUploadList={false}
        >
          <FileUp size={26} />
          <div>{t("officialAccounts.chooseFile")}</div>
          <div className="ant-upload-hint">
            {selectedFileName || t(compatible
              ? "officialAccounts.compatibleFileHint"
              : "officialAccounts.authFileHint")}
          </div>
        </Upload.Dragger>
        <Form.Item
          name="authJson"
          label={t(compatible ? "officialAccounts.compatibleJson" : "officialAccounts.authJson")}
          extra={account
            ? t("officialAccounts.authJsonEditHint")
            : t(compatible ? "officialAccounts.compatibleJsonHint" : "officialAccounts.authJsonHint")}
          style={{ marginTop: 20 }}
        >
          <Input.TextArea
            rows={10}
            autoComplete="off"
            placeholder={compatible
              ? t("officialAccounts.compatibleJsonPlaceholder")
              : '{"tokens":{"access_token":"..."}}'}
          />
        </Form.Item>
        <Form.Item name="note" label={t("common.note")}>
          <Input maxLength={1000} />
        </Form.Item>
        <Form.Item name="expiresAt" label={t("common.expiresAt")}>
          <DatePicker
            showTime={{ format: "HH:mm:ss" }}
            format="YYYY-MM-DD HH:mm:ss"
            placeholder={t("officialAccounts.expiresAtPlaceholder")}
            style={{ width: "100%" }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
