import { useEffect, useState } from "react";
import { App as AntApp, DatePicker, Form, Input, Modal, Upload } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { FileUp } from "lucide-react";
import { useI18n } from "../../i18n-context";
import type { ApiClient, SystemAccount } from "../../types";

interface SystemAccountModalProps {
  open: boolean;
  account: SystemAccount | null;
  mode?: "standard" | "compatible" | "sub2api";
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
  mode = "standard",
  onClose,
  onSaved,
  open,
}: SystemAccountModalProps) {
  const { message } = AntApp.useApp();
  const { t } = useI18n();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");
  const isBatchImport = mode !== "standard";

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
      expiresAt: values.expiresAt?.format("YYYY-MM-DD") ?? "",
    };
    if (content && !isBatchImport) {
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
    if (isBatchImport && account) {
      message.error(t("officialAccounts.compatibleCreateOnly"));
      return;
    }
    if (!content && !account) {
      message.error(t("officialAccounts.authRequired"));
      return;
    }
    setSaving(true);
    try {
      if (isBatchImport) {
        const endpoint = mode === "sub2api"
          ? "/admin/api/official-accounts/import/sub2api"
          : "/admin/api/official-accounts/import";
        const result = await api<CompatibleImportResult>(endpoint, {
          method: "POST",
          body: JSON.stringify({ ...body, content }),
        });
        message.success(t(mode === "sub2api"
          ? "officialAccounts.sub2apiImported"
          : "officialAccounts.compatibleImported", { count: result.importedCount }));
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
        : mode === "sub2api"
          ? "officialAccounts.sub2apiImportTitle"
          : mode === "compatible"
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
            {selectedFileName || t(mode === "sub2api"
              ? "officialAccounts.sub2apiFileHint"
              : mode === "compatible"
                ? "officialAccounts.compatibleFileHint"
                : "officialAccounts.authFileHint")}
          </div>
        </Upload.Dragger>
        <Form.Item
          name="authJson"
          label={t(mode === "sub2api"
            ? "officialAccounts.sub2apiJson"
            : mode === "compatible"
              ? "officialAccounts.compatibleJson"
              : "officialAccounts.authJson")}
          extra={account
            ? t("officialAccounts.authJsonEditHint")
            : t(mode === "sub2api"
              ? "officialAccounts.sub2apiJsonHint"
              : mode === "compatible"
                ? "officialAccounts.compatibleJsonHint"
                : "officialAccounts.authJsonHint")}
          style={{ marginTop: 20 }}
        >
          <Input.TextArea
            rows={10}
            autoComplete="off"
            placeholder={mode === "sub2api"
              ? t("officialAccounts.sub2apiJsonPlaceholder")
              : mode === "compatible"
                ? t("officialAccounts.compatibleJsonPlaceholder")
                : '{"tokens":{"access_token":"..."}}'}
          />
        </Form.Item>
        <Form.Item name="note" label={t("common.note")}>
          <Input maxLength={1000} />
        </Form.Item>
        <Form.Item name="expiresAt" label={t("common.expiresAt")}>
          <DatePicker
            format="YYYY-MM-DD"
            placeholder={t("officialAccounts.expiresAtPlaceholder")}
            style={{ width: "100%" }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
