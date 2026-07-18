import { StatusBar } from 'expo-status-bar';
import { Component, useCallback, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, clearSession, fetchAccountSummary, loadSession, login } from './src/api/client';
import type { AccountSummary, AuthSession, UsageWindow } from './src/types';

const COLORS = {
  ink: '#13231c',
  muted: '#6f8177',
  border: '#dce8df',
  canvas: '#f7faf7',
  card: '#ffffff',
  green: '#18af8c',
  cyan: '#20b4cf',
  paleGreen: '#e6f8f1',
  paleBlue: '#e8f8fb',
  danger: '#dc5c55',
};

class StartupErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Codex Switch startup error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <SafeAreaView style={styles.startupError}>
      <Text style={styles.startupErrorTitle}>应用启动失败</Text>
      <Text style={styles.startupErrorMessage}>请关闭应用后重试；若问题持续，请重新安装最新版本。</Text>
      <Text selectable style={styles.startupErrorDetail}>{this.state.error.message}</Text>
    </SafeAreaView>;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '发生未知错误，请稍后重试';
}

function displayDate(value?: string | null) {
  if (!value) return '未刷新';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未刷新';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function resetLabel(timestamp?: number | null) {
  if (!timestamp) return '重置时间暂不可用';
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return '重置时间暂不可用';
  const milliseconds = date.getTime() - Date.now();
  if (milliseconds <= 0) return '即将重置';
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  return `约 ${days ? `${days} 天 ` : ''}${hours} 小时 ${minutes} 分后重置`;
}

function initials(email: string) {
  return email.slice(0, 2).toUpperCase();
}

function maskEmail(email: string) {
  const at = email.indexOf('@');
  if (at < 2) return '******';
  const local = email.slice(0, at);
  return `${local.slice(0, 2)}${'*'.repeat(Math.min(5, Math.max(2, local.length - 2)))}${email.slice(at)}`;
}

function usageColor(remaining: number) {
  if (remaining <= 15) return COLORS.danger;
  if (remaining <= 40) return '#d89a32';
  return COLORS.cyan;
}

function UsageMeter({ title, usage }: { title: string; usage?: UsageWindow | null }) {
  if (!usage) {
    return <View style={styles.usageBlock}>
      <Text style={styles.usageTitle}>{title}</Text>
      <Text style={styles.usageUnavailable}>--</Text>
    </View>;
  }
  const remaining = Math.max(0, Math.min(100, Math.round(usage.remainingPercent)));
  return <View style={styles.usageBlock}>
    <View style={styles.usageHeader}>
      <Text style={styles.usageTitle}>{title}</Text>
      <Text style={[styles.remaining, { color: usageColor(remaining) }]}>{remaining}% <Text style={styles.remainingLabel}>剩余</Text></Text>
    </View>
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${remaining}%`, backgroundColor: usageColor(remaining) }]} />
    </View>
    <Text style={styles.resetText}>{resetLabel(usage.resetsAt)}</Text>
  </View>;
}

function LoginScreen({ initialBaseUrl, onLoggedIn }: { initialBaseUrl: string; onLoggedIn: (session: AuthSession) => void }) {
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async () => {
    setSubmitting(true);
    try {
      const session = await login(baseUrl, email, password);
      onLoggedIn(session);
    } catch (error) {
      Alert.alert('无法登录', errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }, [baseUrl, email, onLoggedIn, password]);

  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.select({ ios: 'padding', android: undefined })}>
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.logoMark}><Text style={styles.logoGlyph}>↺</Text></View>
        <Text style={styles.loginTitle}>Codex Switch</Text>
        <Text style={styles.loginSubtitle}>登录后查看你的官方账号用量</Text>
        <View style={styles.loginCard}>
          <Text style={styles.fieldLabel}>云端服务器地址</Text>
          <TextInput value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false}
            keyboardType="url" placeholder="https://api.example.com" placeholderTextColor="#98a9a0"
            style={styles.input} editable={!submitting} />
          <Text style={styles.fieldHint}>填写部署 Codex Switch 后端的根地址</Text>
          <Text style={styles.fieldLabel}>邮箱</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false}
            autoComplete="email" keyboardType="email-address" placeholder="name@example.com" placeholderTextColor="#98a9a0"
            style={styles.input} editable={!submitting} />
          <Text style={styles.fieldLabel}>密码</Text>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry autoComplete="password"
            placeholder="输入密码" placeholderTextColor="#98a9a0" style={styles.input} editable={!submitting}
            onSubmitEditing={() => void submit()} />
          <Pressable accessibilityRole="button" style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, submitting && styles.disabled]}
            disabled={submitting} onPress={() => void submit()}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>登录并查看</Text>}
          </Pressable>
        </View>
        <Text style={styles.securityNote}>登录令牌仅保存于本机的系统安全存储中。</Text>
      </ScrollView>
    </SafeAreaView>
  </KeyboardAvoidingView>;
}

function AccountCard({ account, privateMode }: { account: AccountSummary; privateMode: boolean }) {
  const email = privateMode ? maskEmail(account.email) : account.email;
  return <View style={[styles.accountCard, account.active && styles.activeCard]}>
    <View style={styles.accountTop}>
      <View style={[styles.avatar, account.active && styles.activeAvatar]}><Text style={styles.avatarText}>{initials(account.email)}</Text></View>
      <View style={styles.accountNameBlock}>
        <Text style={styles.accountEmail} numberOfLines={1}>{email}</Text>
        <Text style={styles.accountNote} numberOfLines={1}>{privateMode && account.note ? '********' : account.note || '无备注'}</Text>
      </View>
      {account.active && <View style={styles.currentBadge}><Text style={styles.currentBadgeText}>当前</Text></View>}
    </View>
    <View style={styles.metaRow}>
      <View style={styles.planBadge}><Text style={styles.planText}>{account.plan || 'ChatGPT'}</Text></View>
      {account.expiresAt ? <Text style={styles.metaText}>到期 {account.expiresAt}</Text> : null}
      {account.accountId ? <Text style={styles.metaText} numberOfLines={1}>ID {account.accountId}</Text> : null}
    </View>
    <View style={styles.divider} />
    <UsageMeter title="主用量窗口" usage={account.usage.primary} />
    <UsageMeter title="次用量窗口" usage={account.usage.secondary} />
    <Text style={[styles.updatedText, account.usage.error && styles.errorText]}>
      {account.usage.error ? `获取失败：${account.usage.error}` : `数据更新于 ${displayDate(account.usage.fetchedAt)}`}
    </Text>
  </View>;
}

function Dashboard({ session, accounts, loading, refreshing, onRefresh, onLogout }: {
  session: AuthSession;
  accounts: AccountSummary[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
}) {
  const [privateMode, setPrivateMode] = useState(true);
  const active = accounts.find((account) => account.active);
  const latestUpdate = useMemo(() => {
    const timestamps = accounts.map((account) => account.usage.fetchedAt).filter(Boolean).sort();
    return timestamps.length ? timestamps[timestamps.length - 1] : null;
  }, [accounts]);
  return <SafeAreaView style={styles.flex}>
    <StatusBar style="dark" />
    <ScrollView style={styles.flex} contentContainerStyle={styles.dashboardScroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={COLORS.green} />}>
      <View style={styles.header}>
        <View><Text style={styles.brand}>Codex <Text style={styles.brandStrong}>Switch</Text></Text><Text style={styles.headerCaption}>官方账号 · 移动端</Text></View>
        <Pressable accessibilityRole="button" onPress={onLogout} style={styles.logoutButton}><Text style={styles.logoutText}>退出</Text></Pressable>
      </View>
      <View style={styles.overviewCard}>
        <View>
          <Text style={styles.overviewEyebrow}>账户管理</Text>
          <Text style={styles.overviewTitle}>{accounts.length} 个官方账号</Text>
          <Text style={styles.overviewMeta}>{active ? `当前使用：${privateMode ? maskEmail(active.email) : active.email}` : '暂未设置当前账号'}</Text>
        </View>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
          disabled={refreshing} onPress={() => void onRefresh()}>
          {refreshing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.refreshText}>↻ 刷新</Text>}
        </Pressable>
      </View>
      <View style={styles.controlRow}>
        <Text style={styles.lastUpdate}>最近更新：{displayDate(latestUpdate)}</Text>
        <View style={styles.privacyControl}><Text style={styles.privacyText}>隐藏信息</Text><Switch value={privateMode} onValueChange={setPrivateMode} trackColor={{ false: '#c8d6cd', true: '#87d9cb' }} thumbColor={privateMode ? COLORS.green : '#fff'} /></View>
      </View>
      {loading ? <View style={styles.loadingBox}><ActivityIndicator size="large" color={COLORS.green} /><Text style={styles.loadingText}>正在读取账户概览…</Text></View> : null}
      {!loading && accounts.length === 0 ? <View style={styles.emptyBox}><Text style={styles.emptyTitle}>还没有可展示的账号</Text><Text style={styles.emptyText}>请先在桌面端登录并同步账户，然后下拉刷新此页面。</Text></View> : null}
      {!loading && accounts.map((account) => <AccountCard key={account.id} account={account} privateMode={privateMode} />)}
      <Text style={styles.footer}>下拉页面或点击“刷新”可获取最新同步数据</Text>
    </ScrollView>
  </SafeAreaView>;
}

function AppContent() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);

  const refresh = useCallback(async (activeSession = session, quiet = false) => {
    if (!activeSession) return;
    setRefreshing(true);
    try {
      setAccounts(await fetchAccountSummary(activeSession));
    } catch (error) {
      if (error instanceof ApiError && error.message.includes('登录已过期')) setSession(null);
      if (!quiet) Alert.alert('刷新失败', errorMessage(error));
    } finally {
      setRefreshing(false);
    }
  }, [session]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const stored = await loadSession();
        if (!mounted) return;
        setSession(stored);
        if (stored) {
          setLoading(true);
          const nextAccounts = await fetchAccountSummary(stored);
          if (mounted) setAccounts(nextAccounts);
        }
      } catch (error) {
        if (error instanceof ApiError && error.message.includes('登录已过期')) await clearSession();
        if (mounted) setSession(null);
      } finally {
        if (mounted) {
          setLoading(false);
          setInitializing(false);
        }
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && session) void refresh(session, true);
    });
    return () => subscription.remove();
  }, [refresh, session]);

  const handleLogin = useCallback((nextSession: AuthSession) => {
    setSession(nextSession);
    setLoading(true);
    void fetchAccountSummary(nextSession)
      .then(setAccounts)
      .catch((error) => Alert.alert('读取账户失败', errorMessage(error)))
      .finally(() => setLoading(false));
  }, []);

  const handleLogout = useCallback(() => {
    Alert.alert('退出登录', '退出后需重新输入服务器地址、邮箱和密码。', [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: () => {
        void clearSession();
        setSession(null);
        setAccounts([]);
      } },
    ]);
  }, []);

  if (initializing) return <View style={styles.boot}><StatusBar style="dark" /><ActivityIndicator size="large" color={COLORS.green} /><Text style={styles.bootText}>Codex Switch</Text></View>;
  return <View style={styles.app}>{session
    ? <Dashboard session={session} accounts={accounts} loading={loading} refreshing={refreshing} onRefresh={refresh} onLogout={handleLogout} />
    : <LoginScreen initialBaseUrl="" onLoggedIn={handleLogin} />}
  </View>;
}

export default function App() {
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}>
    <StartupErrorBoundary><AppContent /></StartupErrorBoundary>
  </SafeAreaProvider>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, app: { flex: 1, backgroundColor: COLORS.canvas }, boot: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.canvas, gap: 12 }, bootText: { color: COLORS.ink, fontSize: 18, fontWeight: '700' }, startupError: { flex: 1, padding: 28, justifyContent: 'center', backgroundColor: COLORS.canvas }, startupErrorTitle: { color: COLORS.ink, fontSize: 22, fontWeight: '800' }, startupErrorMessage: { color: COLORS.muted, fontSize: 15, lineHeight: 22, marginTop: 12 }, startupErrorDetail: { color: COLORS.danger, fontSize: 12, marginTop: 20 },
  loginScroll: { flexGrow: 1, backgroundColor: COLORS.canvas, padding: 28, justifyContent: 'center' }, logoMark: { width: 58, height: 58, borderRadius: 18, backgroundColor: '#a7e733', justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 18, shadowColor: '#4f7915', shadowOpacity: 0.18, shadowRadius: 14, elevation: 4 }, logoGlyph: { color: '#184122', fontSize: 34, fontWeight: '900' }, loginTitle: { color: COLORS.ink, fontSize: 30, fontWeight: '800', textAlign: 'center' }, loginSubtitle: { color: COLORS.muted, fontSize: 15, textAlign: 'center', marginTop: 8, marginBottom: 30 }, loginCard: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 18, padding: 20, shadowColor: '#314c3d', shadowOpacity: 0.06, shadowRadius: 18, elevation: 2 }, fieldLabel: { color: COLORS.ink, fontSize: 14, fontWeight: '700', marginBottom: 8, marginTop: 14 }, fieldHint: { color: COLORS.muted, fontSize: 12, marginTop: 8 }, input: { height: 48, borderColor: '#cbdcd0', borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, color: COLORS.ink, fontSize: 16, backgroundColor: '#fbfdfb' }, primaryButton: { height: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 11, backgroundColor: COLORS.cyan, marginTop: 24, shadowColor: COLORS.cyan, shadowOpacity: 0.22, shadowRadius: 10, elevation: 3 }, primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 }, pressed: { opacity: 0.82 }, disabled: { opacity: 0.6 }, securityNote: { color: COLORS.muted, fontSize: 12, textAlign: 'center', marginTop: 18 },
  dashboardScroll: { padding: 18, paddingBottom: 34 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }, brand: { color: COLORS.ink, fontSize: 22, fontWeight: '400' }, brandStrong: { fontWeight: '800' }, headerCaption: { color: COLORS.muted, marginTop: 3, fontSize: 12 }, logoutButton: { paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e9b7b2', borderRadius: 9, backgroundColor: '#fffafa' }, logoutText: { color: '#bd3c35', fontWeight: '700', fontSize: 13 }, overviewCard: { backgroundColor: '#112b21', padding: 20, borderRadius: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, overviewEyebrow: { color: '#b5c9bd', fontSize: 13, fontWeight: '700', letterSpacing: 1 }, overviewTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 4 }, overviewMeta: { color: '#c7d7cd', fontSize: 12, marginTop: 8, maxWidth: 195 }, refreshButton: { minWidth: 80, height: 40, borderRadius: 10, backgroundColor: COLORS.cyan, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 }, refreshText: { color: '#fff', fontWeight: '800', fontSize: 15 }, controlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15 }, lastUpdate: { color: COLORS.muted, fontSize: 12, flex: 1 }, privacyControl: { flexDirection: 'row', alignItems: 'center', gap: 7 }, privacyText: { color: COLORS.muted, fontSize: 12 }, loadingBox: { backgroundColor: COLORS.card, borderRadius: 16, padding: 38, alignItems: 'center', gap: 14, borderWidth: 1, borderColor: COLORS.border }, loadingText: { color: COLORS.muted }, emptyBox: { backgroundColor: COLORS.card, borderRadius: 16, padding: 28, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }, emptyTitle: { color: COLORS.ink, fontWeight: '800', fontSize: 17 }, emptyText: { color: COLORS.muted, textAlign: 'center', marginTop: 9, lineHeight: 20 },
  accountCard: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#456152', shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 }, activeCard: { borderColor: '#8fdccf', backgroundColor: COLORS.paleBlue }, accountTop: { flexDirection: 'row', alignItems: 'center' }, avatar: { width: 44, height: 44, borderRadius: 13, backgroundColor: COLORS.paleBlue, justifyContent: 'center', alignItems: 'center' }, activeAvatar: { backgroundColor: '#c9f0e7' }, avatarText: { color: '#178ba1', fontWeight: '800', fontSize: 14 }, accountNameBlock: { flex: 1, minWidth: 0, marginLeft: 11 }, accountEmail: { color: COLORS.ink, fontWeight: '800', fontSize: 16 }, accountNote: { color: COLORS.muted, marginTop: 3, fontSize: 12 }, currentBadge: { backgroundColor: '#c7eee8', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 }, currentBadgeText: { color: '#14806f', fontWeight: '800', fontSize: 12 }, metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 14 }, planBadge: { borderWidth: 1, borderColor: '#cbd7cf', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: '#fff' }, planText: { color: COLORS.ink, fontSize: 12 }, metaText: { color: COLORS.muted, fontSize: 12, maxWidth: 148 }, divider: { height: 1, backgroundColor: '#e4ede6', marginVertical: 15 }, usageBlock: { marginBottom: 14 }, usageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }, usageTitle: { color: COLORS.ink, fontWeight: '700', fontSize: 13 }, remaining: { fontWeight: '800', fontSize: 16 }, remainingLabel: { color: COLORS.muted, fontWeight: '400', fontSize: 12 }, usageUnavailable: { color: COLORS.muted, marginTop: 3 }, progressTrack: { height: 7, borderRadius: 10, overflow: 'hidden', backgroundColor: '#dbe8e0' }, progressFill: { height: '100%', borderRadius: 10 }, resetText: { color: COLORS.muted, fontSize: 12, marginTop: 6 }, updatedText: { color: COLORS.muted, fontSize: 11, marginTop: 2 }, errorText: { color: COLORS.danger }, footer: { color: COLORS.muted, textAlign: 'center', fontSize: 12, marginTop: 12 },
});
