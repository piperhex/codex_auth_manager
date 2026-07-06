import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, ConfigProvider, Table, Tag, theme as antdTheme } from "antd";
import type { ColumnsType } from "antd/es/table";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { RefreshCw } from "lucide-react";
import { loadTokenUsageEntries } from "../api/backend";
import { useLanguage } from "../hooks/useLanguage";
import { useThemeColor } from "../hooks/useThemeColor";
import type { TokenUsageEntry } from "../types";

const ignoreError = () => undefined;

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" ? new Intl.NumberFormat().format(value) : "--";
}

function formatDuration(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function formatTime(timestamp: number, language: "en" | "zh") {
  return new Date(timestamp * 1000).toLocaleString(language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function hasTokenValue(entry: TokenUsageEntry) {
  return [
    entry.inputTokens,
    entry.outputTokens,
    entry.reasoningTokens,
    entry.cachedTokens,
    entry.totalTokens,
  ].some((value) => typeof value === "number");
}

function TokenSummary({ entry, language }: { entry: TokenUsageEntry; language: "en" | "zh" }) {
  if (!hasTokenValue(entry)) {
    return <span className="token-summary-missing">{language === "zh" ? "未返回" : "Not returned"}</span>;
  }
  const labels = language === "zh"
    ? { input: "输入", output: "输出", reasoning: "推理", cached: "缓存读取", total: "总计" }
    : { input: "Input", output: "Output", reasoning: "Reasoning", cached: "Cache read", total: "Total" };
  return (
    <div className="token-summary">
      <span><b>{labels.input}</b>{formatNumber(entry.inputTokens)}</span>
      <span><b>{labels.output}</b>{formatNumber(entry.outputTokens)}</span>
      <span><b>{labels.reasoning}</b>{formatNumber(entry.reasoningTokens)}</span>
      <span><b>{labels.cached}</b>{formatNumber(entry.cachedTokens)}</span>
      <span className="token-summary-total"><b>{labels.total}</b>{formatNumber(entry.totalTokens)}</span>
    </div>
  );
}

export function TokenUsageWindow() {
  const { language } = useLanguage();
  const themeColor = useThemeColor(ignoreError);
  const [entries, setEntries] = useState<TokenUsageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("token-usage-page");
    return () => document.documentElement.classList.remove("token-usage-page");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await loadTokenUsageEntries());
    } catch (error) {
      setError(String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const columns = useMemo<ColumnsType<TokenUsageEntry>>(() => [
    {
      title: language === "zh" ? "时间" : "Time",
      dataIndex: "ts",
      width: 190,
      render: (value: number) => <span className="token-time">{formatTime(value, language)}</span>,
    },
    {
      title: "Provider",
      dataIndex: "provider",
      width: 180,
      render: (value: string) => <strong className="token-provider">{value}</strong>,
    },
    {
      title: language === "zh" ? "模型" : "Model",
      dataIndex: "model",
      width: 220,
      render: (value: string) => <code className="token-model-code">{value}</code>,
    },
    {
      title: language === "zh" ? "耗时" : "Duration",
      dataIndex: "durationMs",
      width: 110,
      render: (value: number | null | undefined) => <Tag className="token-duration-tag">{formatDuration(value)}</Tag>,
    },
    {
      title: language === "zh" ? "Token 汇总" : "Token Summary",
      width: 210,
      render: (_, entry) => <TokenSummary entry={entry} language={language} />,
    },
  ], [language]);

  return (
    <ConfigProvider locale={language === "zh" ? zhCN : enUS} theme={{
      algorithm: antdTheme.compactAlgorithm,
      token: { colorPrimary: themeColor.color, borderRadius: 6, fontFamily: "\"DM Sans\", \"Microsoft YaHei UI\", sans-serif" },
    }}>
      <div className="token-usage-shell">
        <header className="token-usage-header">
          <div>
            <span>{language === "zh" ? "PROVIDER / TOKEN" : "PROVIDER / TOKEN"}</span>
            <h1>{language === "zh" ? "Token 消耗汇总" : "Token Usage"}</h1>
          </div>
          <Button icon={<RefreshCw className={loading ? "spin" : ""} size={15} />} onClick={() => void load()} disabled={loading}>
            {language === "zh" ? "刷新" : "Refresh"}
          </Button>
        </header>
        {error ? <div className="token-usage-error">{error}</div> : null}
        <div className="token-usage-table-wrap">
          <Table rowKey="id" size="small" columns={columns} dataSource={entries}
            loading={loading} pagination={{ pageSize: 20, showSizeChanger: false }}
            locale={{ emptyText: language === "zh" ? "暂无 Token 记录" : "No token records" }}
            scroll={{ x: 910, y: "calc(100vh - 190px)" }} />
        </div>
      </div>
    </ConfigProvider>
  );
}
