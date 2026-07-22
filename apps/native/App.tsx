import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  ActivityIndicator,
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
import {
  changePassword,
  clearSession,
  DEFAULT_GLOBAL_REFRESH_MINUTES,
  DEFAULT_CLOUD_BASE_URL,
  fetchAccountSummary,
  fetchUserProfile,
  isSessionExpiredError,
  loadGlobalRefreshMinutes,
  loadSession,
  login,
  saveGlobalRefreshMinutes,
} from './src/api/client';
import type { AccountSummary, AuthSession, UsageWindow, UserProfile } from './src/types';
import { reportMobileInstallation } from './src/telemetry';
import { AdminArea } from './src/admin/AdminArea';
import { AppToastHost, Toast } from './src/components/AppToast';
import { BottomSheet } from './src/components/BottomSheet';

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
  const usingOfficialServer = baseUrl.trim().replace(/\/+$/, '').toLowerCase() === DEFAULT_CLOUD_BASE_URL.toLowerCase();

  const submit = useCallback(async () => {
    setSubmitting(true);
    try {
      const session = await login(baseUrl, email, password);
      onLoggedIn(session);
    } catch (error) {
      Toast.fail(`无法登录：${errorMessage(error)}`);
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
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>云端服务器地址</Text>
            {!usingOfficialServer ? <Pressable accessibilityRole="button" disabled={submitting}
              onPress={() => setBaseUrl(DEFAULT_CLOUD_BASE_URL)} style={({ pressed }) => [styles.officialServerButton, pressed && styles.pressed]}>
              <Text style={styles.officialServerButtonText}>使用官方服务器</Text>
            </Pressable> : null}
          </View>
          <TextInput value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false}
            keyboardType="url" placeholder={DEFAULT_CLOUD_BASE_URL} placeholderTextColor="#98a9a0"
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

function AccountCard({ account, privateMode, onOpenNote }: {
  account: AccountSummary;
  privateMode: boolean;
  onOpenNote: (account: AccountSummary) => void;
}) {
  const email = privateMode ? maskEmail(account.email) : account.email;
  return <View style={[styles.accountCard, account.active && styles.activeCard]}>
    <View style={styles.accountTop}>
      <View style={[styles.avatar, account.active && styles.activeAvatar]}><Text style={styles.avatarText}>{initials(account.email)}</Text></View>
      <View style={styles.accountNameBlock}>
        <Text style={styles.accountEmail} numberOfLines={1}>{email}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${account.email} 的备注`}
          accessibilityHint="查看完整备注" hitSlop={6} onPress={() => onOpenNote(account)}
          style={({ pressed }) => [styles.accountNoteButton, pressed && styles.pressed]}>
          <Text style={styles.accountNote} numberOfLines={1}>{privateMode && account.note ? '********' : account.note || '无备注'}</Text>
        </Pressable>
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

function Dashboard({ accounts, loading, refreshing, onRefresh }: {
  accounts: AccountSummary[];
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [privateMode, setPrivateMode] = useState(true);
  const [noteAccount, setNoteAccount] = useState<AccountSummary | null>(null);
  const active = accounts.find((account) => account.active);
  const latestUpdate = useMemo(() => {
    const timestamps = accounts.map((account) => account.usage.fetchedAt).filter(Boolean).sort();
    return timestamps.length ? timestamps[timestamps.length - 1] : null;
  }, [accounts]);
  return <>
    <ScrollView style={styles.flex} contentContainerStyle={styles.dashboardScroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={COLORS.green} />}>
      <View style={styles.header}>
        <View><Text style={styles.brand}>Codex <Text style={styles.brandStrong}>Switch</Text></Text><Text style={styles.headerCaption}>官方账号 · 移动端</Text></View>
      </View>
      <View style={styles.overviewCard}>
        <View>
          <Text style={styles.overviewEyebrow}>账户管理</Text>
          <Text style={styles.overviewTitle}>{accounts.length} 个官方账号</Text>
          <Text style={styles.overviewMeta}>{active ? `当前使用：${privateMode ? maskEmail(active.email) : active.email}` : '暂未设置当前账号'}</Text>
        </View>
        <Pressable accessibilityRole="button" style={({ pressed }) => [styles.refreshButton, pressed && styles.pressed]}
          disabled={refreshing} onPress={() => void onRefresh()}>
          {refreshing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.refreshText}>↻ 刷新全部</Text>}
        </Pressable>
      </View>
      <View style={styles.controlRow}>
        <Text style={styles.lastUpdate}>最近更新：{displayDate(latestUpdate)}</Text>
        <View style={styles.privacyControl}><Text style={styles.privacyText}>隐藏信息</Text><Switch value={privateMode} onValueChange={setPrivateMode} trackColor={{ false: '#c8d6cd', true: '#87d9cb' }} thumbColor={privateMode ? COLORS.green : '#fff'} /></View>
      </View>
      {loading ? <View style={styles.loadingBox}><ActivityIndicator size="large" color={COLORS.green} /><Text style={styles.loadingText}>正在读取账户概览…</Text></View> : null}
      {!loading && accounts.length === 0 ? <View style={styles.emptyBox}><Text style={styles.emptyTitle}>还没有可展示的账号</Text><Text style={styles.emptyText}>请先在桌面端登录并同步账户，然后下拉刷新此页面。</Text></View> : null}
      {!loading && accounts.map((account) => <AccountCard key={account.id} account={account} privateMode={privateMode} onOpenNote={setNoteAccount} />)}
      <Text style={styles.footer}>下拉页面或点击“刷新全部”将更新所有账号</Text>
    </ScrollView>
    <NoteDrawer account={noteAccount} onClose={() => setNoteAccount(null)} />
  </>;
}

function identityLabel(profile?: UserProfile | null) {
  if (!profile) return '加载中…';
  if (profile.roleName) return profile.roleName;
  if (profile.role === 'admin') return '管理员';
  if (profile.role === 'user') return '用户';
  return profile.role;
}

function SettingsPage({ session, profile, globalRefreshMinutes, onGlobalRefreshMinutesChange, onLogout }: {
  session: AuthSession;
  profile: UserProfile | null;
  globalRefreshMinutes: number;
  onGlobalRefreshMinutesChange: (minutes: number) => Promise<void>;
  onLogout: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [logoutDrawerVisible, setLogoutDrawerVisible] = useState(false);
  const [refreshMinutesInput, setRefreshMinutesInput] = useState(String(globalRefreshMinutes));
  const [savingRefreshInterval, setSavingRefreshInterval] = useState(false);
  const activeProfile = profile ?? session.profile;
  const username = activeProfile?.email ?? session.email;

  const closePasswordModal = useCallback(() => {
    if (saving) return;
    setPasswordModalVisible(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }, [saving]);

  useEffect(() => setRefreshMinutesInput(String(globalRefreshMinutes)), [globalRefreshMinutes]);

  const saveRefreshInterval = useCallback(async () => {
    const minutes = Number(refreshMinutesInput);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      Toast.fail('请输入 1 到 1440 之间的整数分钟');
      return;
    }
    setSavingRefreshInterval(true);
    try {
      await onGlobalRefreshMinutesChange(minutes);
      Toast.success(`已设置为每 ${minutes} 分钟自动刷新`);
    } catch (error) {
      Toast.fail(errorMessage(error));
    } finally {
      setSavingRefreshInterval(false);
    }
  }, [onGlobalRefreshMinutesChange, refreshMinutesInput]);

  const submitPassword = useCallback(async () => {
    if (currentPassword.length < 6) {
      Toast.fail('当前密码至少需要 6 位');
      return;
    }
    if (newPassword.length < 8) {
      Toast.fail('新密码至少需要 8 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      Toast.fail('两次输入的新密码不一致');
      return;
    }
    setSaving(true);
    try {
      await changePassword(session, currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordModalVisible(false);
      Toast.success('密码已修改，下次登录请使用新密码');
    } catch (error) {
      Toast.fail(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [confirmPassword, currentPassword, newPassword, session]);

  return <KeyboardAvoidingView style={styles.flex} behavior={Platform.select({ ios: 'padding', android: undefined })}>
    <ScrollView style={styles.flex} contentContainerStyle={styles.settingsScroll} keyboardShouldPersistTaps="handled">
      <View style={styles.settingsHeader}>
        <Text style={styles.settingsTitle}>设置</Text>
        <Text style={styles.settingsSubtitle}>账号与安全</Text>
      </View>

      <Text style={styles.sectionLabel}>用户信息</Text>
      <View style={styles.settingsCard}>
        <View style={styles.profileSummary}>
          <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{initials(username)}</Text></View>
          <View style={styles.profileSummaryText}>
            <Text style={styles.profileName} numberOfLines={1}>{username}</Text>
            <Text style={styles.profileCaption}>Codex Switch 云端账号</Text>
          </View>
        </View>
        <View style={styles.settingsDivider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>用户名</Text>
          <Text selectable style={styles.infoValue} numberOfLines={1}>{username}</Text>
        </View>
        <View style={styles.rowDivider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>身份信息</Text>
          <View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{identityLabel(activeProfile)}</Text></View>
        </View>
      </View>

      <Text style={styles.sectionLabel}>刷新设置</Text>
      <View style={styles.settingsCard}>
        <Text style={styles.refreshSettingsTitle}>全局自动刷新</Text>
        <Text style={styles.passwordHint}>统一刷新账号管理页中的所有账号，仅保留这一项全局配置。</Text>
        <View style={styles.refreshIntervalRow}>
          <TextInput value={refreshMinutesInput} onChangeText={(value) => setRefreshMinutesInput(value.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad" placeholder="30" placeholderTextColor="#98a9a0" style={styles.refreshIntervalInput}
            editable={!savingRefreshInterval} onSubmitEditing={() => void saveRefreshInterval()} />
          <Text style={styles.refreshIntervalUnit}>分钟</Text>
          <Pressable accessibilityRole="button" disabled={savingRefreshInterval}
            onPress={() => void saveRefreshInterval()} style={({ pressed }) => [styles.saveIntervalButton, pressed && styles.pressed, savingRefreshInterval && styles.disabled]}>
            {savingRefreshInterval ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveIntervalText}>保存</Text>}
          </Pressable>
        </View>
        <Text style={styles.refreshSettingsHint}>默认 30 分钟；下拉刷新和“刷新全部”按钮不受此间隔限制。</Text>
      </View>

      <Text style={styles.sectionLabel}>修改密码</Text>
      <Pressable accessibilityRole="button" accessibilityHint="打开修改密码抽屉"
        onPress={() => setPasswordModalVisible(true)} style={({ pressed }) => [styles.settingsCard, styles.passwordEntry, pressed && styles.pressed]}>
        <View style={styles.passwordEntryText}>
          <Text style={styles.refreshSettingsTitle}>登录密码</Text>
          <Text style={styles.passwordHint}>验证当前密码后设置新密码</Text>
        </View>
        <Text style={styles.passwordEntryArrow}>›</Text>
      </Pressable>

      <Pressable accessibilityRole="button" onPress={() => setLogoutDrawerVisible(true)}
        style={({ pressed }) => [styles.settingsLogoutButton, pressed && styles.pressed]}>
        <Text style={styles.settingsLogoutText}>退出登录</Text>
      </Pressable>
      <Text style={styles.securityNote}>登录令牌与账号信息保存在本机系统安全存储中。</Text>
    </ScrollView>
    <BottomSheet
      visible={passwordModalVisible}
      title="修改密码"
      subtitle="验证当前密码后设置新的登录密码"
      onClose={closePasswordModal}
      dismissible={!saving}
      tall
      actions={[
        { label: '取消', onPress: closePasswordModal, disabled: saving },
        { label: '确认修改', tone: 'primary', onPress: submitPassword, loading: saving },
      ]}
    >
      <ScrollView style={styles.passwordDrawerBody} keyboardShouldPersistTaps="handled">
        <Text style={styles.passwordHint}>修改密码前需要验证当前密码，新密码至少 8 位。</Text>
        <Text style={styles.fieldLabel}>当前密码</Text>
        <TextInput value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry
          autoComplete="current-password" placeholder="输入当前密码" placeholderTextColor="#98a9a0"
          style={styles.input} editable={!saving} />
        <Text style={styles.fieldLabel}>新密码</Text>
        <TextInput value={newPassword} onChangeText={setNewPassword} secureTextEntry
          autoComplete="new-password" placeholder="至少 8 位" placeholderTextColor="#98a9a0"
          style={styles.input} editable={!saving} />
        <Text style={styles.fieldLabel}>确认新密码</Text>
        <TextInput value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry
          autoComplete="new-password" placeholder="再次输入新密码" placeholderTextColor="#98a9a0"
          style={styles.input} editable={!saving} onSubmitEditing={() => void submitPassword()} />
      </ScrollView>
    </BottomSheet>
    <BottomSheet
      visible={logoutDrawerVisible}
      title="退出登录"
      subtitle="退出后需要重新输入服务器地址、邮箱和密码"
      onClose={() => setLogoutDrawerVisible(false)}
      actions={[
        { label: '继续使用', onPress: () => setLogoutDrawerVisible(false) },
        { label: '退出登录', tone: 'danger', onPress: () => { setLogoutDrawerVisible(false); onLogout(); } },
      ]}
    >
      <View style={styles.logoutConfirmBox}>
        <View style={styles.logoutConfirmIcon}><Text style={styles.logoutConfirmIconText}>↪</Text></View>
        <Text style={styles.logoutConfirmTitle}>确定要退出当前账号吗？</Text>
        <Text style={styles.logoutConfirmText}>本机保存的登录会话将被清除，云端数据不会受到影响。</Text>
      </View>
    </BottomSheet>
  </KeyboardAvoidingView>;
}

type AppPage = 'accounts' | 'admin' | 'settings';

function BottomNavigation({ activePage, isAdmin, onChange }: { activePage: AppPage; isAdmin: boolean; onChange: (page: AppPage) => void }) {
  return <View style={styles.bottomNavigation} accessibilityRole="tablist">
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: activePage === 'accounts' }}
      onPress={() => onChange('accounts')} style={styles.navItem}>
      <Text style={[styles.navIcon, activePage === 'accounts' && styles.navTextActive]}>▦</Text>
      <Text style={[styles.navText, activePage === 'accounts' && styles.navTextActive]}>账号</Text>
    </Pressable>
    {isAdmin && <Pressable accessibilityRole="tab" accessibilityState={{ selected: activePage === 'admin' }}
      onPress={() => onChange('admin')} style={styles.navItem}>
      <Text style={[styles.navIcon, activePage === 'admin' && styles.navTextActive]}>▣</Text>
      <Text style={[styles.navText, activePage === 'admin' && styles.navTextActive]}>管理员</Text>
    </Pressable>}
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: activePage === 'settings' }}
      onPress={() => onChange('settings')} style={styles.navItem}>
      <Text style={[styles.navIcon, activePage === 'settings' && styles.navTextActive]}>⚙</Text>
      <Text style={[styles.navText, activePage === 'settings' && styles.navTextActive]}>设置</Text>
    </Pressable>
  </View>;
}

function NoteDrawer({ account, onClose }: { account: AccountSummary | null; onClose: () => void }) {
  return <BottomSheet
    visible={Boolean(account)}
    title="账号备注"
    subtitle={account?.email}
    onClose={onClose}
    actions={[{ label: '完成', tone: 'primary', onPress: onClose }]}
  >
    <View style={styles.noteContentBox}>
      <ScrollView style={styles.noteContentScroll} contentContainerStyle={styles.noteContentScrollInner}>
        <Text selectable style={[styles.noteContentText, !account?.note && styles.noteEmptyText]}>
          {account?.note || '该账号暂无备注'}
        </Text>
      </ScrollView>
    </View>
  </BottomSheet>;
}

function AppContent() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [activePage, setActivePage] = useState<AppPage>('accounts');
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [globalRefreshMinutes, setGlobalRefreshMinutes] = useState(DEFAULT_GLOBAL_REFRESH_MINUTES);
  const refreshingRef = useRef(false);
  const lastRefreshAtRef = useRef(0);

  const refreshAll = useCallback(async (activeSession = session, quiet = false) => {
    if (!activeSession || refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      setAccounts(await fetchAccountSummary(activeSession));
      lastRefreshAtRef.current = Date.now();
    } catch (error) {
      if (isSessionExpiredError(error)) {
        setSession(null);
        setProfile(null);
        setAccounts([]);
        setActivePage('accounts');
      }
      if (!quiet) Toast.fail(errorMessage(error));
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [session]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [stored, storedRefreshMinutes] = await Promise.all([
          loadSession(),
          loadGlobalRefreshMinutes(),
        ]);
        void reportMobileInstallation(stored?.baseUrl ?? DEFAULT_CLOUD_BASE_URL).catch(() => undefined);
        if (!mounted) return;
        setGlobalRefreshMinutes(storedRefreshMinutes);
        setSession(stored);
        if (stored) {
          setProfile(stored.profile ?? null);
          setLoading(true);
          const [accountsResult, profileResult] = await Promise.allSettled([
            fetchAccountSummary(stored),
            fetchUserProfile(stored),
          ]);
          if (!mounted) return;

          const sessionError = [accountsResult, profileResult]
            .find((result) => result.status === 'rejected' && isSessionExpiredError(result.reason));
          if (sessionError) {
            setSession(null);
            setProfile(null);
            setAccounts([]);
          } else {
            if (accountsResult.status === 'fulfilled') {
              setAccounts(accountsResult.value);
              lastRefreshAtRef.current = Date.now();
            }
            if (profileResult.status === 'fulfilled') setProfile(profileResult.value);
            if (accountsResult.status === 'rejected' || profileResult.status === 'rejected') {
              Toast.fail('暂时无法同步云端数据，登录状态已保留');
            }
          }
        }
      } catch (error) {
        if (isSessionExpiredError(error)) {
          await clearSession();
          if (mounted) setSession(null);
        } else if (mounted) {
          Toast.fail('读取本地登录信息失败，请重新打开应用');
        }
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
    if (!session) return undefined;
    const intervalMilliseconds = globalRefreshMinutes * 60_000;
    const refreshWhenDue = () => {
      if (Date.now() - lastRefreshAtRef.current >= intervalMilliseconds) {
        void refreshAll(session, true);
      }
    };
    const timer = setInterval(refreshWhenDue, intervalMilliseconds);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshWhenDue();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [globalRefreshMinutes, refreshAll, session]);

  const handleLogin = useCallback((nextSession: AuthSession) => {
    void reportMobileInstallation(nextSession.baseUrl).catch(() => undefined);
    setSession(nextSession);
    setProfile(nextSession.profile ?? null);
    setActivePage('accounts');
    setLoading(true);
    void fetchAccountSummary(nextSession)
      .then((nextAccounts) => {
        setAccounts(nextAccounts);
        lastRefreshAtRef.current = Date.now();
      })
      .catch((error) => Toast.fail(`读取账户失败：${errorMessage(error)}`))
      .finally(() => setLoading(false));
    void fetchUserProfile(nextSession)
      .then(setProfile)
      .catch((error) => Toast.fail(`读取用户身份失败：${errorMessage(error)}`));
  }, []);

  const handleGlobalRefreshMinutesChange = useCallback(async (minutes: number) => {
    await saveGlobalRefreshMinutes(minutes);
    setGlobalRefreshMinutes(minutes);
  }, []);

  const handleLogout = useCallback(() => {
    void clearSession();
    setSession(null);
    setProfile(null);
    setAccounts([]);
    setActivePage('accounts');
  }, []);

  if (initializing) return <View style={styles.boot}><StatusBar style="dark" /><ActivityIndicator size="large" color={COLORS.green} /><Text style={styles.bootText}>Codex Switch</Text></View>;
  if (!session) return <View style={styles.app}>
    <LoginScreen initialBaseUrl={DEFAULT_CLOUD_BASE_URL} onLoggedIn={handleLogin} />
  </View>;
  return <SafeAreaView style={styles.app}>
    <StatusBar style="dark" />
    {activePage === 'accounts'
      ? <Dashboard accounts={accounts} loading={loading} refreshing={refreshing} onRefresh={refreshAll} />
      : activePage === 'admin' && profile?.role === 'admin'
        ? <AdminArea session={session} profile={profile} />
        : <SettingsPage session={session} profile={profile} globalRefreshMinutes={globalRefreshMinutes}
          onGlobalRefreshMinutesChange={handleGlobalRefreshMinutesChange} onLogout={handleLogout} />}
    <BottomNavigation activePage={activePage} isAdmin={profile?.role === 'admin'} onChange={setActivePage} />
  </SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider initialMetrics={initialWindowMetrics}>
    <StartupErrorBoundary><AppContent /></StartupErrorBoundary>
    <AppToastHost />
  </SafeAreaProvider>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, app: { flex: 1, backgroundColor: COLORS.canvas }, boot: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.canvas, gap: 12 }, bootText: { color: COLORS.ink, fontSize: 18, fontWeight: '700' }, startupError: { flex: 1, padding: 28, justifyContent: 'center', backgroundColor: COLORS.canvas }, startupErrorTitle: { color: COLORS.ink, fontSize: 22, fontWeight: '800' }, startupErrorMessage: { color: COLORS.muted, fontSize: 15, lineHeight: 22, marginTop: 12 }, startupErrorDetail: { color: COLORS.danger, fontSize: 12, marginTop: 20 },
  loginScroll: { flexGrow: 1, backgroundColor: COLORS.canvas, padding: 28, justifyContent: 'center' }, logoMark: { width: 58, height: 58, borderRadius: 18, backgroundColor: '#a7e733', justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 18, shadowColor: '#4f7915', shadowOpacity: 0.18, shadowRadius: 14, elevation: 4 }, logoGlyph: { color: '#184122', fontSize: 34, fontWeight: '900' }, loginTitle: { color: COLORS.ink, fontSize: 30, fontWeight: '800', textAlign: 'center' }, loginSubtitle: { color: COLORS.muted, fontSize: 15, textAlign: 'center', marginTop: 8, marginBottom: 30 }, loginCard: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 18, padding: 20, shadowColor: '#314c3d', shadowOpacity: 0.06, shadowRadius: 18, elevation: 2 }, fieldLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 }, fieldLabel: { color: COLORS.ink, fontSize: 14, fontWeight: '700', marginBottom: 8, marginTop: 14 }, officialServerButton: { paddingVertical: 6, paddingHorizontal: 9, borderRadius: 8, backgroundColor: COLORS.paleBlue, marginTop: 6 }, officialServerButtonText: { color: '#168da2', fontWeight: '700', fontSize: 12 }, fieldHint: { color: COLORS.muted, fontSize: 12, marginTop: 8 }, input: { height: 48, borderColor: '#cbdcd0', borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, color: COLORS.ink, fontSize: 16, backgroundColor: '#fbfdfb' }, primaryButton: { height: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 11, backgroundColor: COLORS.cyan, marginTop: 24, shadowColor: COLORS.cyan, shadowOpacity: 0.22, shadowRadius: 10, elevation: 3 }, primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 }, pressed: { opacity: 0.82 }, disabled: { opacity: 0.6 }, securityNote: { color: COLORS.muted, fontSize: 12, textAlign: 'center', marginTop: 18 },
  dashboardScroll: { padding: 18, paddingBottom: 34 }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }, brand: { color: COLORS.ink, fontSize: 22, fontWeight: '400' }, brandStrong: { fontWeight: '800' }, headerCaption: { color: COLORS.muted, marginTop: 3, fontSize: 12 }, logoutButton: { paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#e9b7b2', borderRadius: 9, backgroundColor: '#fffafa' }, logoutText: { color: '#bd3c35', fontWeight: '700', fontSize: 13 }, overviewCard: { backgroundColor: '#112b21', padding: 20, borderRadius: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, overviewEyebrow: { color: '#b5c9bd', fontSize: 13, fontWeight: '700', letterSpacing: 1 }, overviewTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 4 }, overviewMeta: { color: '#c7d7cd', fontSize: 12, marginTop: 8, maxWidth: 195 }, refreshButton: { minWidth: 106, height: 40, borderRadius: 10, backgroundColor: COLORS.cyan, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 }, refreshText: { color: '#fff', fontWeight: '800', fontSize: 14 }, controlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15 }, lastUpdate: { color: COLORS.muted, fontSize: 12, flex: 1 }, privacyControl: { flexDirection: 'row', alignItems: 'center', gap: 7 }, privacyText: { color: COLORS.muted, fontSize: 12 }, loadingBox: { backgroundColor: COLORS.card, borderRadius: 16, padding: 38, alignItems: 'center', gap: 14, borderWidth: 1, borderColor: COLORS.border }, loadingText: { color: COLORS.muted }, emptyBox: { backgroundColor: COLORS.card, borderRadius: 16, padding: 28, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border }, emptyTitle: { color: COLORS.ink, fontWeight: '800', fontSize: 17 }, emptyText: { color: COLORS.muted, textAlign: 'center', marginTop: 9, lineHeight: 20 },
  accountCard: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#456152', shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 }, activeCard: { borderColor: '#8fdccf', backgroundColor: COLORS.paleBlue }, accountTop: { flexDirection: 'row', alignItems: 'center' }, avatar: { width: 44, height: 44, borderRadius: 13, backgroundColor: COLORS.paleBlue, justifyContent: 'center', alignItems: 'center' }, activeAvatar: { backgroundColor: '#c9f0e7' }, avatarText: { color: '#178ba1', fontWeight: '800', fontSize: 14 }, accountNameBlock: { flex: 1, minWidth: 0, marginLeft: 11 }, accountEmail: { color: COLORS.ink, fontWeight: '800', fontSize: 16 }, accountNote: { color: COLORS.muted, marginTop: 3, fontSize: 12 }, currentBadge: { backgroundColor: '#c7eee8', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 }, currentBadgeText: { color: '#14806f', fontWeight: '800', fontSize: 12 }, metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 14 }, planBadge: { borderWidth: 1, borderColor: '#cbd7cf', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: '#fff' }, planText: { color: COLORS.ink, fontSize: 12 }, metaText: { color: COLORS.muted, fontSize: 12, maxWidth: 148 }, divider: { height: 1, backgroundColor: '#e4ede6', marginVertical: 15 }, usageBlock: { marginBottom: 14 }, usageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }, usageTitle: { color: COLORS.ink, fontWeight: '700', fontSize: 13 }, remaining: { fontWeight: '800', fontSize: 16 }, remainingLabel: { color: COLORS.muted, fontWeight: '400', fontSize: 12 }, usageUnavailable: { color: COLORS.muted, marginTop: 3 }, progressTrack: { height: 7, borderRadius: 10, overflow: 'hidden', backgroundColor: '#dbe8e0' }, progressFill: { height: '100%', borderRadius: 10 }, resetText: { color: COLORS.muted, fontSize: 12, marginTop: 6 }, updatedText: { color: COLORS.muted, fontSize: 11, marginTop: 2 }, errorText: { color: COLORS.danger }, footer: { color: COLORS.muted, textAlign: 'center', fontSize: 12, marginTop: 12 },
  accountNoteButton: { minHeight: 22, justifyContent: 'center' },
  noteModalRoot: { flex: 1, justifyContent: 'flex-end' }, noteBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8, 24, 18, 0.42)' }, noteDrawer: { maxHeight: '72%', minHeight: 250, backgroundColor: COLORS.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10, paddingHorizontal: 20, shadowColor: '#10261d', shadowOpacity: 0.2, shadowRadius: 18, elevation: 18 }, noteDrawerHandle: { width: 42, height: 5, borderRadius: 3, alignSelf: 'center', backgroundColor: '#cddbd2', marginBottom: 15 }, noteDrawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }, noteDrawerHeading: { flex: 1, minWidth: 0 }, noteDrawerTitle: { color: COLORS.ink, fontSize: 20, fontWeight: '800' }, noteDrawerAccount: { color: COLORS.muted, fontSize: 12, marginTop: 4 }, noteDrawerClose: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, backgroundColor: COLORS.paleBlue }, noteDrawerCloseText: { color: '#168da2', fontSize: 13, fontWeight: '800' }, noteContentBox: { minHeight: 130, maxHeight: 360, backgroundColor: COLORS.canvas, borderColor: COLORS.border, borderWidth: 1, borderRadius: 14, marginTop: 18, marginBottom: 18, overflow: 'hidden' }, noteContentScroll: { flexGrow: 0 }, noteContentScrollInner: { padding: 16 }, noteContentText: { color: COLORS.ink, fontSize: 15, lineHeight: 24 }, noteEmptyText: { color: COLORS.muted },
  settingsScroll: { padding: 18, paddingBottom: 30 }, settingsHeader: { marginBottom: 24 }, settingsTitle: { color: COLORS.ink, fontSize: 28, fontWeight: '800' }, settingsSubtitle: { color: COLORS.muted, fontSize: 13, marginTop: 4 }, sectionLabel: { color: COLORS.muted, fontSize: 13, fontWeight: '700', marginLeft: 3, marginBottom: 9, marginTop: 2 }, settingsCard: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 16, padding: 17, marginBottom: 22, shadowColor: '#456152', shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 }, profileSummary: { flexDirection: 'row', alignItems: 'center' }, profileAvatar: { width: 50, height: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#c9f0e7' }, profileAvatarText: { color: '#14806f', fontSize: 16, fontWeight: '800' }, profileSummaryText: { flex: 1, minWidth: 0, marginLeft: 12 }, profileName: { color: COLORS.ink, fontSize: 16, fontWeight: '800' }, profileCaption: { color: COLORS.muted, fontSize: 12, marginTop: 4 }, settingsDivider: { height: 1, backgroundColor: '#e4ede6', marginVertical: 16 }, infoRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }, infoLabel: { color: COLORS.muted, fontSize: 14 }, infoValue: { color: COLORS.ink, fontSize: 14, fontWeight: '700', flex: 1, textAlign: 'right' }, rowDivider: { height: 1, backgroundColor: '#eef3ef', marginVertical: 7 }, roleBadge: { backgroundColor: COLORS.paleBlue, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 }, roleBadgeText: { color: '#168da2', fontWeight: '800', fontSize: 12 }, passwordHint: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginBottom: 2 }, settingsLogoutButton: { height: 48, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#e9b7b2', borderRadius: 12, backgroundColor: '#fffafa' }, settingsLogoutText: { color: '#bd3c35', fontWeight: '800', fontSize: 15 },
  refreshSettingsTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '800', marginBottom: 6 }, refreshIntervalRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 16 }, refreshIntervalInput: { width: 88, height: 44, borderWidth: 1, borderColor: '#cbdcd0', borderRadius: 9, backgroundColor: '#fbfdfb', color: COLORS.ink, fontSize: 16, textAlign: 'center' }, refreshIntervalUnit: { color: COLORS.muted, fontSize: 14, flex: 1 }, saveIntervalButton: { minWidth: 72, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: COLORS.cyan, paddingHorizontal: 14 }, saveIntervalText: { color: '#fff', fontWeight: '800', fontSize: 14 }, refreshSettingsHint: { color: COLORS.muted, fontSize: 11, lineHeight: 17, marginTop: 12 },
  passwordEntry: { flexDirection: 'row', alignItems: 'center', minHeight: 76 }, passwordEntryText: { flex: 1 }, passwordEntryArrow: { color: '#91a198', fontSize: 30, lineHeight: 32, marginLeft: 12 }, passwordDrawerBody: { maxHeight: 500, paddingTop: 2, paddingBottom: 6 },
  logoutConfirmBox: { alignItems: 'center', borderRadius: 17, backgroundColor: COLORS.canvas, padding: 20 }, logoutConfirmIcon: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fbe8e6', marginBottom: 13 }, logoutConfirmIconText: { color: COLORS.danger, fontSize: 23, fontWeight: '900' }, logoutConfirmTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '900', textAlign: 'center' }, logoutConfirmText: { color: COLORS.muted, fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 7 },
  bottomNavigation: { flexDirection: 'row', backgroundColor: COLORS.card, borderTopWidth: 1, borderTopColor: COLORS.border, shadowColor: '#314c3d', shadowOpacity: 0.08, shadowRadius: 8, elevation: 10 }, navItem: { flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 2 }, navIcon: { color: '#8a9b91', fontSize: 20, lineHeight: 23 }, navText: { color: '#7b8c82', fontSize: 11, fontWeight: '700' }, navTextActive: { color: COLORS.green },
});
