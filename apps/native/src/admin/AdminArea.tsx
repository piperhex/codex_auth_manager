import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { adminRequest } from '../api/client';
import { Toast } from '../components/AppToast';
import { BottomSheet } from '../components/BottomSheet';
import type {
  AdminDashboardOverview,
  AdminFeedback,
  AdminInvitation,
  AdminOfficialAccount,
  AdminRole,
  AdminUser,
  AuthSession,
  InvitationRegisteredUser,
  PageResult,
  UserProfile,
} from '../types';

type AdminPage = 'home' | 'dashboard' | 'officialAccounts' | 'invitations' | 'feedback' | 'users';
type Tone = 'green' | 'blue' | 'amber' | 'purple' | 'red' | 'gray';

interface AdminAreaProps {
  session: AuthSession;
  profile: UserProfile;
}

const COLORS = {
  canvas: '#f4f7f5',
  surface: '#ffffff',
  ink: '#10251d',
  muted: '#6d7c75',
  faint: '#93a099',
  border: '#e0e8e3',
  primary: '#0b8065',
  primaryDark: '#0f382b',
  primarySoft: '#def4ec',
  blue: '#2f72c4',
  blueSoft: '#e7f0fb',
  amber: '#a96b10',
  amberSoft: '#fff0d8',
  purple: '#7354b5',
  purpleSoft: '#eee8fb',
  red: '#c54b43',
  redSoft: '#fbe8e6',
};

const EMPTY_PAGE = { items: [], total: 0, page: 1, pageSize: 20 };

const entries: Array<{
  key: Exclude<AdminPage, 'home'>;
  title: string;
  subtitle: string;
  icon: string;
  tone: Tone;
}> = [
  { key: 'dashboard', title: '数据仪表盘', subtitle: '用户、设备与增长趋势', icon: '数', tone: 'blue' },
  { key: 'officialAccounts', title: '官方账号池', subtitle: '账号凭据与用户绑定', icon: '号', tone: 'green' },
  { key: 'invitations', title: '邀请注册', subtitle: '邀请链接与使用记录', icon: '邀', tone: 'amber' },
  { key: 'feedback', title: '问题反馈', subtitle: '查看详情并邮件回复', icon: '馈', tone: 'purple' },
  { key: 'users', title: '用户管理', subtitle: '用户角色与账号状态', icon: '人', tone: 'red' },
];

const pageMeta: Record<AdminPage, { title: string; subtitle: string }> = {
  home: { title: '管理控制台', subtitle: '集中管理 Codex Switch 服务' },
  dashboard: { title: '数据仪表盘', subtitle: '关键运营数据与趋势' },
  officialAccounts: { title: '官方账号池', subtitle: '维护账号凭据和绑定关系' },
  invitations: { title: '邀请注册', subtitle: '管理注册链接和使用状态' },
  feedback: { title: '问题反馈', subtitle: '跟进用户提交的问题' },
  users: { title: '用户管理', subtitle: '维护用户角色和登录状态' },
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后重试';
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function has(profile: UserProfile, permission: string) {
  return profile.role === 'admin' && (profile.permissions?.includes(permission) ?? true);
}

function percentage(value: number, total: number): `${number}%` {
  return `${Math.max(4, Math.min(100, Math.round((value / Math.max(1, total)) * 100)))}%`;
}

function toneStyles(tone: Tone) {
  if (tone === 'green') return { backgroundColor: COLORS.primarySoft, color: COLORS.primary };
  if (tone === 'blue') return { backgroundColor: COLORS.blueSoft, color: COLORS.blue };
  if (tone === 'amber') return { backgroundColor: COLORS.amberSoft, color: COLORS.amber };
  if (tone === 'purple') return { backgroundColor: COLORS.purpleSoft, color: COLORS.purple };
  if (tone === 'red') return { backgroundColor: COLORS.redSoft, color: COLORS.red };
  return { backgroundColor: '#eef2ef', color: '#5f7067' };
}

function AdminButton({ label, onPress, tone = 'secondary', loading = false, disabled = false, compact = false }: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary' | 'danger' | 'quiet';
  loading?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  const onColor = tone === 'primary' || tone === 'danger';
  return <Pressable
    accessibilityRole="button"
    disabled={disabled || loading}
    onPress={onPress}
    style={({ pressed }) => [
      styles.button,
      compact && styles.buttonCompact,
      tone === 'primary' && styles.buttonPrimary,
      tone === 'danger' && styles.buttonDanger,
      tone === 'quiet' && styles.buttonQuiet,
      pressed && styles.pressed,
      (disabled || loading) && styles.disabled,
    ]}
  >
    {loading
      ? <ActivityIndicator size="small" color={onColor ? '#fff' : COLORS.primary} />
      : <Text style={[styles.buttonText, onColor && styles.buttonTextOnColor, tone === 'quiet' && styles.buttonTextQuiet]}>{label}</Text>}
  </Pressable>;
}

function Pill({ children, tone = 'gray' }: { children: ReactNode; tone?: Tone }) {
  const colors = toneStyles(tone);
  return <View style={[styles.pill, { backgroundColor: colors.backgroundColor }]}>
    <Text style={[styles.pillText, { color: colors.color }]}>{children}</Text>
  </View>;
}

function Surface({ children }: { children: ReactNode }) {
  return <View style={styles.surface}>{children}</View>;
}

function PageShell({ page, onBack, children }: { page: AdminPage; onBack: () => void; children: ReactNode }) {
  const meta = pageMeta[page];
  return <View style={styles.flex}>
    <View style={styles.pageHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="返回管理控制台"
        hitSlop={8}
        onPress={onBack}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
      >
        <Text style={styles.backArrow}>‹</Text>
      </Pressable>
      <View style={styles.pageHeading}>
        <Text style={styles.pageTitle}>{meta.title}</Text>
        <Text style={styles.pageSubtitle}>{meta.subtitle}</Text>
      </View>
    </View>
    {children}
  </View>;
}

function Toolbar({ total, loading, onRefresh, children }: {
  total?: number;
  loading: boolean;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  return <View style={styles.toolbar}>
    <View>
      <Text style={styles.toolbarEyebrow}>当前数据</Text>
      <Text style={styles.toolbarCount}>{total === undefined ? '管理后台' : `${total} 条记录`}</Text>
    </View>
    <View style={styles.toolbarActions}>
      <AdminButton label={loading ? '刷新中' : '刷新'} loading={loading} onPress={onRefresh} compact />
      {children}
    </View>
  </View>;
}

function Pager({ value, onChange }: { value: PageResult<unknown>; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(value.total / value.pageSize));
  if (pages <= 1) return null;
  return <View style={styles.pager}>
    <AdminButton label="上一页" compact disabled={value.page <= 1} onPress={() => onChange(value.page - 1)} />
    <View style={styles.pageBadge}><Text style={styles.pageBadgeText}>{value.page} / {pages}</Text></View>
    <AdminButton label="下一页" compact disabled={value.page >= pages} onPress={() => onChange(value.page + 1)} />
  </View>;
}

function LoadingOrEmpty({ loading, empty, label = '暂无数据', children }: {
  loading: boolean;
  empty: boolean;
  label?: string;
  children: ReactNode;
}) {
  if (loading) return <View style={styles.stateBox}>
    <View style={styles.stateIcon}><ActivityIndicator color={COLORS.primary} /></View>
    <Text style={styles.stateTitle}>正在加载</Text>
    <Text style={styles.stateDescription}>稍等一下，数据马上就来</Text>
  </View>;
  if (empty) return <View style={styles.stateBox}>
    <View style={styles.stateIcon}><Text style={styles.stateIconText}>—</Text></View>
    <Text style={styles.stateTitle}>{label}</Text>
    <Text style={styles.stateDescription}>当前没有需要展示的记录</Text>
  </View>;
  return <>{children}</>;
}

function Field({ label, value, onChangeText, placeholder, secureTextEntry, multiline, keyboardType, hint }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric';
  hint?: string;
}) {
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#9aa8a0"
      secureTextEntry={secureTextEntry}
      multiline={multiline}
      keyboardType={keyboardType}
      autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
      textAlignVertical={multiline ? 'top' : 'center'}
      style={[styles.input, multiline && styles.textarea]}
    />
    {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
  </View>;
}

function SearchBar({ value, onChangeText, onSearch, placeholder }: {
  value: string;
  onChangeText: (value: string) => void;
  onSearch: () => void;
  placeholder: string;
}) {
  return <View style={styles.searchWrap}>
    <View style={styles.searchInputWrap}>
      <Text style={styles.searchIcon}>⌕</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSearch}
        returnKeyType="search"
        autoCapitalize="none"
        placeholder={placeholder}
        placeholderTextColor="#93a099"
        style={styles.searchInput}
      />
    </View>
    <AdminButton label="搜索" tone="primary" compact onPress={onSearch} />
  </View>;
}

function SwitchRow({ label, description, value, onValueChange }: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return <View style={styles.switchRow}>
    <View style={styles.switchCopy}>
      <Text style={styles.switchLabel}>{label}</Text>
      {description ? <Text style={styles.switchDescription}>{description}</Text> : null}
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: '#cbd6d0', true: '#8bd4c2' }}
      thumbColor={value ? COLORS.primary : '#ffffff'}
    />
  </View>;
}

function ConfirmCopy({ icon, title, description, tone = 'red' }: {
  icon: string;
  title: string;
  description: string;
  tone?: Tone;
}) {
  const colors = toneStyles(tone);
  return <View style={styles.confirmBox}>
    <View style={[styles.confirmIcon, { backgroundColor: colors.backgroundColor }]}>
      <Text style={[styles.confirmIconText, { color: colors.color }]}>{icon}</Text>
    </View>
    <Text style={styles.confirmTitle}>{title}</Text>
    <Text style={styles.confirmDescription}>{description}</Text>
  </View>;
}

function AdminHome({ profile, onOpen }: { profile: UserProfile; onOpen: (page: AdminPage) => void }) {
  return <ScrollView style={styles.flex} contentContainerStyle={styles.homeScroll}>
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <View style={styles.heroMark}><Text style={styles.heroMarkText}>CS</Text></View>
        <Pill tone="green">管理员在线</Pill>
      </View>
      <Text style={styles.heroEyebrow}>CONTROL CENTER</Text>
      <Text style={styles.heroTitle}>管理控制台</Text>
      <Text style={styles.heroSubtitle}>账号、用户与运营数据，一处掌握。</Text>
      <View style={styles.heroIdentity}>
        <View style={styles.heroDot} />
        <Text style={styles.heroIdentityText} numberOfLines={1}>{profile.email}</Text>
      </View>
    </View>

    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>工作台</Text>
      <Text style={styles.sectionCaption}>5 个管理模块</Text>
    </View>
    <View style={styles.entryList}>
      {entries.map((entry) => {
        const colors = toneStyles(entry.tone);
        return <Pressable
          key={entry.key}
          accessibilityRole="button"
          onPress={() => onOpen(entry.key)}
          style={({ pressed }) => [styles.entryCard, pressed && styles.pressed]}
        >
          <View style={[styles.entryIcon, { backgroundColor: colors.backgroundColor }]}>
            <Text style={[styles.entryIconText, { color: colors.color }]}>{entry.icon}</Text>
          </View>
          <View style={styles.entryCopy}>
            <Text style={styles.entryTitle}>{entry.title}</Text>
            <Text style={styles.entrySubtitle}>{entry.subtitle}</Text>
          </View>
          <View style={styles.entryArrow}><Text style={styles.entryArrowText}>›</Text></View>
        </Pressable>;
      })}
    </View>
  </ScrollView>;
}

function DashboardPage({ session, onBack }: AdminAreaProps & { onBack: () => void }) {
  const [data, setData] = useState<AdminDashboardOverview | null>(null);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await adminRequest(session, `/admin/api/dashboard/overview?days=${days}`)); }
    catch (error) { Toast.fail(messageOf(error)); }
    finally { setLoading(false); }
  }, [days, session]);
  useEffect(() => { void load(); }, [load]);

  const metrics: Array<{ label: string; value: number; note: string; tone: Tone }> = [
    { label: '用户总数', value: data?.summary.totalUsers ?? 0, note: `活跃 ${data?.summary.activeUsers ?? 0} · 新增 ${data?.summary.newUsers ?? 0}`, tone: 'blue' },
    { label: '设备安装', value: data?.summary.totalInstallations ?? 0, note: `新增 ${data?.summary.newInstallations ?? 0}`, tone: 'green' },
    { label: '官方账号', value: data?.summary.officialAccounts ?? 0, note: `已绑定 ${data?.summary.boundOfficialAccounts ?? 0}`, tone: 'purple' },
    { label: '待处理事项', value: (data?.summary.pendingFeedback ?? 0) + (data?.summary.pendingApprovals ?? 0), note: `反馈 ${data?.summary.pendingFeedback ?? 0} · 审批 ${data?.summary.pendingApprovals ?? 0}`, tone: 'amber' },
  ];
  const trend = data?.trend.slice(-10) ?? [];
  const trendMax = Math.max(1, ...trend.map((item) => item.users + item.installations));
  const platformTotal = Math.max(1, ...(data?.platforms.map((item) => item.value) ?? [1]));

  return <PageShell page="dashboard" onBack={onBack}>
    <ScrollView
      contentContainerStyle={styles.pageScroll}
      refreshControl={<RefreshControl refreshing={loading} tintColor={COLORS.primary} onRefresh={() => void load()} />}
    >
      <View style={styles.segmented}>
        {([7, 30, 90] as const).map((item) => <Pressable
          key={item}
          onPress={() => setDays(item)}
          style={[styles.segment, days === item && styles.segmentActive]}
        >
          <Text style={[styles.segmentText, days === item && styles.segmentTextActive]}>{item} 天</Text>
        </Pressable>)}
      </View>

      <View style={styles.metricGrid}>
        {metrics.map((metric) => {
          const colors = toneStyles(metric.tone);
          return <View key={metric.label} style={styles.metricCard}>
            <View style={[styles.metricAccent, { backgroundColor: colors.backgroundColor }]}>
              <View style={[styles.metricAccentDot, { backgroundColor: colors.color }]} />
            </View>
            <Text style={styles.metricLabel}>{metric.label}</Text>
            <Text style={styles.metricValue}>{metric.value}</Text>
            <Text style={styles.metricNote}>{metric.note}</Text>
          </View>;
        })}
      </View>

      <Surface>
        <View style={styles.panelHeader}>
          <View><Text style={styles.panelTitle}>增长趋势</Text><Text style={styles.panelSubtitle}>最近 10 个数据点</Text></View>
          {data ? <Pill tone="gray">{data.range.startDate} – {data.range.endDate}</Pill> : null}
        </View>
        {trend.length ? trend.map((item) => <View key={item.date} style={styles.chartRow}>
          <Text style={styles.chartLabel}>{item.date.slice(5)}</Text>
          <View style={styles.chartTrack}>
            <View style={[styles.chartFill, { width: percentage(item.users + item.installations, trendMax) }]} />
          </View>
          <Text style={styles.chartValue}>+{item.users + item.installations}</Text>
        </View>) : <Text style={styles.inlineEmpty}>暂无趋势数据</Text>}
      </Surface>

      <Surface>
        <View style={styles.panelHeader}>
          <View><Text style={styles.panelTitle}>平台分布</Text><Text style={styles.panelSubtitle}>已安装设备来源</Text></View>
        </View>
        {data?.platforms.length ? data.platforms.map((item, index) => <View key={item.name} style={styles.distributionRow}>
          <View style={styles.distributionMeta}><Text style={styles.distributionName}>{item.name}</Text><Text style={styles.distributionValue}>{item.value}</Text></View>
          <View style={styles.distributionTrack}><View style={[
            styles.distributionFill,
            { width: percentage(item.value, platformTotal), backgroundColor: index % 2 ? COLORS.blue : COLORS.primary },
          ]} /></View>
        </View>) : <Text style={styles.inlineEmpty}>暂无平台数据</Text>}
      </Surface>
    </ScrollView>
  </PageShell>;
}

function OfficialAccountsPage({ session, profile, onBack }: AdminAreaProps & { onBack: () => void }) {
  const [data, setData] = useState<PageResult<AdminOfficialAccount>>(EMPTY_PAGE);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AdminOfficialAccount | 'new' | null>(null);
  const [authJson, setAuthJson] = useState('');
  const [note, setNote] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [binding, setBinding] = useState<AdminOfficialAccount | null>(null);
  const [bindingUsers, setBindingUsers] = useState<AdminUser[]>([]);
  const [boundIds, setBoundIds] = useState<string[]>([]);
  const [initialBoundIds, setInitialBoundIds] = useState<string[]>([]);
  const [bindingLoading, setBindingLoading] = useState(false);
  const [deleting, setDeleting] = useState<AdminOfficialAccount | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const canManage = has(profile, 'admin.official-accounts.manage');

  const load = useCallback(async (page = data.page) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(data.pageSize) });
      if (search.trim()) query.set('search', search.trim());
      setData(await adminRequest(session, `/admin/api/official-accounts?${query}`));
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setLoading(false); }
  }, [data.page, data.pageSize, search, session]);
  useEffect(() => { void load(1); }, [session]);

  function openEditor(account: AdminOfficialAccount | 'new') {
    setEditing(account);
    setAuthJson('');
    setNote(account === 'new' ? '' : account.note ?? '');
    setExpiresAt(account === 'new' ? '' : account.expiresAt ?? '');
  }

  async function save() {
    const body: Record<string, unknown> = { note, expiresAt };
    if (authJson.trim()) {
      try { body.auth = JSON.parse(authJson.replace(/^\uFEFF/, '')); }
      catch { Toast.fail('auth.json 内容不是有效 JSON'); return; }
    } else if (editing === 'new') { Toast.fail('请填写 auth.json'); return; }
    setSaving(true);
    try {
      await adminRequest(session, editing === 'new' ? '/admin/api/official-accounts' : `/admin/api/official-accounts/${editing?.id}`, {
        method: editing === 'new' ? 'POST' : 'PATCH',
        body: JSON.stringify(body),
      });
      Toast.success(editing === 'new' ? '账号已添加' : '账号已更新');
      const firstPage = editing === 'new';
      setEditing(null);
      await load(firstPage ? 1 : data.page);
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setSaving(false); }
  }

  async function confirmRemove() {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await adminRequest(session, `/admin/api/official-accounts/${deleting.id}`, { method: 'DELETE' });
      Toast.success('账号已删除');
      setDeleting(null);
      await load();
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setDeletingBusy(false); }
  }

  async function openBindings(account: AdminOfficialAccount) {
    setBinding(account);
    setBindingUsers([]);
    setBindingLoading(true);
    try {
      const [users, bound] = await Promise.all([
        adminRequest<PageResult<AdminUser>>(session, '/admin/api/users?page=1&pageSize=100'),
        adminRequest<{ userIds: string[] }>(session, `/admin/api/official-accounts/${account.id}/bindings`),
      ]);
      setBindingUsers(users.items);
      setBoundIds(bound.userIds);
      setInitialBoundIds(bound.userIds);
    } catch (error) { setBinding(null); Toast.fail(messageOf(error)); }
    finally { setBindingLoading(false); }
  }

  async function saveBindings() {
    if (!binding) return;
    const added = boundIds.filter((id) => !initialBoundIds.includes(id));
    const removed = initialBoundIds.filter((id) => !boundIds.includes(id));
    setSaving(true);
    try {
      if (added.length) await adminRequest(session, '/admin/api/official-accounts/bind', { method: 'POST', body: JSON.stringify({ systemAccountIds: [binding.id], userIds: added }) });
      if (removed.length) await adminRequest(session, '/admin/api/official-accounts/unbind', { method: 'POST', body: JSON.stringify({ systemAccountIds: [binding.id], userIds: removed }) });
      Toast.success('绑定已更新');
      setBinding(null);
      await load();
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setSaving(false); }
  }

  return <PageShell page="officialAccounts" onBack={onBack}>
    <SearchBar value={search} onChangeText={setSearch} onSearch={() => void load(1)} placeholder="搜索邮箱、备注或账号 ID" />
    <Toolbar total={data.total} loading={loading} onRefresh={() => void load()}>
      {canManage ? <AdminButton label="＋ 新增" tone="primary" compact onPress={() => openEditor('new')} /> : null}
    </Toolbar>
    <ScrollView contentContainerStyle={styles.listScroll} keyboardShouldPersistTaps="handled">
      <LoadingOrEmpty loading={loading} empty={!data.items.length}>
        {data.items.map((account) => <Surface key={account.id}>
          <View style={styles.cardHeader}>
            <View style={[styles.avatar, { backgroundColor: COLORS.primarySoft }]}><Text style={[styles.avatarText, { color: COLORS.primary }]}>号</Text></View>
            <View style={styles.cardHeading}>
              <Text style={styles.cardTitle} numberOfLines={1}>{account.email}</Text>
              <Text style={styles.cardSubtitle}>更新于 {formatDate(account.updatedAt)}</Text>
            </View>
            <Pill tone={account.boundUserCount ? 'green' : 'gray'}>{account.boundUserCount} 个绑定</Pill>
          </View>
          <View style={styles.pillRow}>
            <Pill tone="blue">{account.plan || 'ChatGPT'}</Pill>
            {account.expiresAt ? <Pill tone="amber">到期 {account.expiresAt}</Pill> : null}
          </View>
          <Text style={[styles.bodyText, !account.note && styles.placeholderText]}>{account.note || '暂无备注'}</Text>
          {canManage ? <View style={styles.cardActions}>
            <AdminButton label="编辑" compact onPress={() => openEditor(account)} />
            <AdminButton label="绑定用户" compact onPress={() => void openBindings(account)} />
            <AdminButton label="删除" tone="quiet" compact onPress={() => setDeleting(account)} />
          </View> : null}
        </Surface>)}
      </LoadingOrEmpty>
      <Pager value={data} onChange={(page) => void load(page)} />
    </ScrollView>

    <BottomSheet
      visible={Boolean(editing)}
      title={editing === 'new' ? '新增官方账号' : '编辑官方账号'}
      subtitle={editing === 'new' ? '导入凭据并补充账号信息' : editing ? editing.email : undefined}
      onClose={() => setEditing(null)}
      dismissible={!saving}
      tall
      actions={[
        { label: '取消', onPress: () => setEditing(null), disabled: saving },
        { label: '保存账号', tone: 'primary', onPress: save, loading: saving },
      ]}
    >
      <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
        <Field label="auth.json" value={authJson} onChangeText={setAuthJson} placeholder={editing === 'new' ? '{"tokens":{"access_token":"..."}}' : '留空表示不修改凭据'} multiline hint="请粘贴完整的账号认证 JSON" />
        <Field label="备注" value={note} onChangeText={setNote} placeholder="给账号添加便于识别的说明" />
        <Field label="到期日期" value={expiresAt} onChangeText={setExpiresAt} placeholder="YYYY-MM-DD" />
      </ScrollView>
    </BottomSheet>

    <BottomSheet
      visible={Boolean(binding)}
      title="绑定用户"
      subtitle={binding?.email}
      onClose={() => setBinding(null)}
      dismissible={!saving}
      tall
      actions={[
        { label: '取消', onPress: () => setBinding(null), disabled: saving },
        { label: `保存 ${boundIds.length} 项`, tone: 'primary', onPress: saveBindings, loading: saving, disabled: bindingLoading },
      ]}
    >
      <ScrollView style={styles.bindingList}>
        {bindingLoading ? <View style={styles.sheetLoading}><ActivityIndicator color={COLORS.primary} /><Text style={styles.stateDescription}>正在读取用户…</Text></View> : null}
        {!bindingLoading && !bindingUsers.length ? <Text style={styles.inlineEmpty}>暂无可绑定用户</Text> : null}
        {bindingUsers.map((user) => {
          const checked = boundIds.includes(user.id);
          return <Pressable
            key={user.id}
            onPress={() => setBoundIds((ids) => checked ? ids.filter((id) => id !== user.id) : [...ids, user.id])}
            style={({ pressed }) => [styles.checkRow, checked && styles.checkRowActive, pressed && styles.pressed]}
          >
            <View style={[styles.checkbox, checked && styles.checkboxChecked]}><Text style={styles.checkboxText}>{checked ? '✓' : ''}</Text></View>
            <View style={styles.checkCopy}><Text style={styles.checkLabel}>{user.email}</Text><Text style={styles.checkMeta}>{user.role}</Text></View>
          </Pressable>;
        })}
      </ScrollView>
    </BottomSheet>

    <BottomSheet
      visible={Boolean(deleting)}
      title="删除官方账号"
      subtitle="此操作无法撤销"
      onClose={() => setDeleting(null)}
      dismissible={!deletingBusy}
      actions={[
        { label: '取消', onPress: () => setDeleting(null), disabled: deletingBusy },
        { label: '确认删除', tone: 'danger', onPress: confirmRemove, loading: deletingBusy },
      ]}
    >
      <ConfirmCopy icon="!" title={deleting?.email ?? ''} description="删除后，该账号的凭据和绑定关系将永久移除。" />
    </BottomSheet>
  </PageShell>;
}

function InvitationsPage({ session, profile, onBack }: AdminAreaProps & { onBack: () => void }) {
  const [data, setData] = useState<PageResult<AdminInvitation>>(EMPTY_PAGE);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [maxUses, setMaxUses] = useState('1');
  const [hours, setHours] = useState('72');
  const [neverExpires, setNeverExpires] = useState(false);
  const [usersInvite, setUsersInvite] = useState<AdminInvitation | null>(null);
  const [registeredUsers, setRegisteredUsers] = useState<InvitationRegisteredUser[]>([]);
  const [registeredLoading, setRegisteredLoading] = useState(false);
  const [giftUser, setGiftUser] = useState<InvitationRegisteredUser | null>(null);
  const [giftAccounts, setGiftAccounts] = useState<PageResult<AdminOfficialAccount>>(EMPTY_PAGE);
  const [giftSelectedIds, setGiftSelectedIds] = useState<string[]>([]);
  const [giftLoading, setGiftLoading] = useState(false);
  const [giftSaving, setGiftSaving] = useState(false);
  const [revoking, setRevoking] = useState<AdminInvitation | null>(null);
  const [revokingBusy, setRevokingBusy] = useState(false);
  const canManage = has(profile, 'admin.invitations.manage');
  const canGiftAccounts = has(profile, 'admin.official-accounts.manage');

  const load = useCallback(async (page = data.page) => {
    setLoading(true);
    try { setData(await adminRequest(session, `/admin/api/invitations?page=${page}&pageSize=${data.pageSize}`)); }
    catch (error) { Toast.fail(messageOf(error)); }
    finally { setLoading(false); }
  }, [data.page, data.pageSize, session]);
  useEffect(() => { void load(1); }, [session]);

  function openCreate() {
    setEmail(''); setRole('user'); setMaxUses('1'); setHours('72'); setNeverExpires(false); setCreating(true);
  }

  async function create() {
    const uses = Number(maxUses);
    const validHours = Number(hours);
    if (!Number.isInteger(uses) || uses < 1 || (!neverExpires && (!Number.isFinite(validHours) || validHours < 1))) {
      Toast.fail('请填写有效的使用次数和有效期');
      return;
    }
    setCreatingBusy(true);
    try {
      const invitation = await adminRequest<AdminInvitation & { token?: string }>(session, '/admin/api/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() || undefined, role, maxUses: uses, neverExpires, expiresInHours: neverExpires ? undefined : validHours }),
      });
      setCreating(false);
      await load(1);
      if (invitation.token) {
        const link = `${session.baseUrl}/admin?inviteToken=${encodeURIComponent(invitation.token)}`;
        await Clipboard.setStringAsync(link);
        Toast.success('邀请已创建，链接已复制');
      }
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setCreatingBusy(false); }
  }

  async function copy(item: AdminInvitation) {
    try {
      const result = await adminRequest<{ token: string }>(session, `/admin/api/invitations/${item.id}/token`, { method: 'POST' });
      await Clipboard.setStringAsync(`${session.baseUrl}/admin?inviteToken=${encodeURIComponent(result.token)}`);
      Toast.success('注册链接已复制');
    } catch (error) { Toast.fail(messageOf(error)); }
  }

  async function openRegisteredUsers(item: AdminInvitation) {
    setUsersInvite(item);
    setRegisteredUsers([]);
    setRegisteredLoading(true);
    try {
      const result = await adminRequest<PageResult<InvitationRegisteredUser>>(session, `/admin/api/invitations/${item.id}/users?page=1&pageSize=100`);
      setRegisteredUsers(result.items);
    } catch (error) { setUsersInvite(null); Toast.fail(messageOf(error)); }
    finally { setRegisteredLoading(false); }
  }

  async function loadGiftAccounts(page = 1) {
    setGiftLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(giftAccounts.pageSize),
        sortBy: 'boundUserCount',
        sortOrder: 'asc',
      });
      setGiftAccounts(await adminRequest<PageResult<AdminOfficialAccount>>(session, `/admin/api/official-accounts?${query}`));
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setGiftLoading(false); }
  }

  function openGift(user: InvitationRegisteredUser) {
    if (!user.userId) {
      Toast.fail('该注册记录未关联有效用户');
      return;
    }
    setGiftUser(user);
    setGiftAccounts(EMPTY_PAGE);
    setGiftSelectedIds([]);
    void loadGiftAccounts(1);
  }

  async function confirmGift() {
    if (!giftUser?.userId || !giftSelectedIds.length) {
      Toast.fail('请至少选择一个官方账号');
      return;
    }
    setGiftSaving(true);
    try {
      const result = await adminRequest<{ count: number }>(session, '/admin/api/official-accounts/bind', {
        method: 'POST',
        body: JSON.stringify({ systemAccountIds: giftSelectedIds, userIds: [giftUser.userId] }),
      });
      Toast.success(result.count
        ? `已向 ${giftUser.email} 赠送 ${result.count} 个账号`
        : '所选账号均已赠送，无需重复操作');
      setGiftUser(null);
      if (usersInvite) await openRegisteredUsers(usersInvite);
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setGiftSaving(false); }
  }

  async function confirmRevoke() {
    if (!revoking) return;
    setRevokingBusy(true);
    try {
      await adminRequest(session, `/admin/api/invitations/${revoking.id}`, { method: 'DELETE' });
      Toast.success('邀请已撤销');
      setRevoking(null);
      await load();
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setRevokingBusy(false); }
  }

  const status = (item: AdminInvitation) => item.revokedAt
    ? '已撤销'
    : item.usedCount >= item.maxUses
      ? '已用完'
      : item.expiresAt && new Date(item.expiresAt) <= new Date()
        ? '已过期'
        : '有效';

  return <PageShell page="invitations" onBack={onBack}>
    <Toolbar total={data.total} loading={loading} onRefresh={() => void load()}>
      {canManage ? <AdminButton label="＋ 创建邀请" tone="primary" compact onPress={openCreate} /> : null}
    </Toolbar>
    <ScrollView contentContainerStyle={styles.listScroll}>
      <LoadingOrEmpty loading={loading} empty={!data.items.length}>
        {data.items.map((item) => {
          const currentStatus = status(item);
          const active = currentStatus === '有效';
          return <Surface key={item.id}>
            <View style={styles.cardHeader}>
              <View style={[styles.avatar, { backgroundColor: COLORS.amberSoft }]}><Text style={[styles.avatarText, { color: COLORS.amber }]}>邀</Text></View>
              <View style={styles.cardHeading}>
                <Text style={styles.cardTitle} numberOfLines={1}>{item.email || '任意邮箱'}</Text>
                <Text style={styles.cardSubtitle}>由 {item.createdByEmail} 创建</Text>
              </View>
              <Pill tone={active ? 'green' : 'gray'}>{currentStatus}</Pill>
            </View>
            <View style={styles.infoGrid}>
              <View style={styles.infoCell}><Text style={styles.infoCellLabel}>角色</Text><Text style={styles.infoCellValue}>{item.role}</Text></View>
              <View style={styles.infoCell}><Text style={styles.infoCellLabel}>使用进度</Text><Text style={styles.infoCellValue}>{item.usedCount} / {item.maxUses}</Text></View>
            </View>
            <Text style={styles.cardFootnote}>到期时间：{item.expiresAt ? formatDate(item.expiresAt) : '永不过期'}</Text>
            <View style={styles.cardActions}>
              <AdminButton label="注册用户" compact onPress={() => void openRegisteredUsers(item)} />
              {canManage ? <>
                <AdminButton label="复制链接" compact disabled={!active} onPress={() => void copy(item)} />
                <AdminButton label="撤销" tone="quiet" compact disabled={!active} onPress={() => setRevoking(item)} />
              </> : null}
            </View>
          </Surface>;
        })}
      </LoadingOrEmpty>
      <Pager value={data} onChange={(page) => void load(page)} />
    </ScrollView>

    <BottomSheet
      visible={creating}
      title="创建邀请"
      subtitle="创建后注册链接会自动复制到剪贴板"
      onClose={() => setCreating(false)}
      dismissible={!creatingBusy}
      tall
      actions={[
        { label: '取消', onPress: () => setCreating(false), disabled: creatingBusy },
        { label: '创建并复制', tone: 'primary', onPress: create, loading: creatingBusy },
      ]}
    >
      <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
        <Field label="指定邮箱（可选）" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="留空允许任意邮箱" />
        <Field label="角色代码" value={role} onChangeText={setRole} placeholder="user" />
        <Field label="最大使用次数" value={maxUses} onChangeText={setMaxUses} keyboardType="numeric" />
        <SwitchRow label="永不过期" description="开启后注册链接不会自动失效" value={neverExpires} onValueChange={setNeverExpires} />
        {!neverExpires ? <Field label="有效小时数" value={hours} onChangeText={setHours} keyboardType="numeric" /> : null}
      </ScrollView>
    </BottomSheet>

    <BottomSheet
      visible={Boolean(usersInvite) && !giftUser}
      title="已注册用户"
      subtitle={usersInvite?.email || '任意邮箱邀请'}
      onClose={() => setUsersInvite(null)}
      tall
      actions={[{ label: '完成', tone: 'primary', onPress: () => setUsersInvite(null) }]}
    >
      <ScrollView style={styles.sheetScroll}>
        {registeredLoading ? <View style={styles.sheetLoading}><ActivityIndicator color={COLORS.primary} /><Text style={styles.stateDescription}>正在读取注册记录…</Text></View> : null}
        {!registeredLoading && !registeredUsers.length ? <Text style={styles.inlineEmpty}>暂无注册用户</Text> : null}
        {registeredUsers.map((user) => <View key={user.id} style={styles.personRow}>
          <View style={[styles.miniAvatar, { backgroundColor: COLORS.blueSoft }]}><Text style={[styles.miniAvatarText, { color: COLORS.blue }]}>{user.email.slice(0, 2).toUpperCase()}</Text></View>
          <View style={styles.personCopy}><Text style={styles.personName} numberOfLines={1}>{user.email}</Text><Text style={styles.personMeta}>{user.role} · {formatDate(user.registeredAt)}</Text></View>
          <View style={styles.personActions}>
            <Pill tone="purple">{user.giftedAccountCount} 个账号</Pill>
            {canGiftAccounts && user.userId ? <AdminButton label="赠送" tone="primary" compact onPress={() => openGift(user)} /> : null}
          </View>
        </View>)}
      </ScrollView>
    </BottomSheet>

    <BottomSheet
      visible={Boolean(giftUser)}
      title="赠送官方账号"
      subtitle={giftUser?.email}
      onClose={() => setGiftUser(null)}
      dismissible={!giftSaving}
      tall
      actions={[
        { label: '取消', onPress: () => setGiftUser(null), disabled: giftSaving },
        { label: `赠送 ${giftSelectedIds.length} 个`, tone: 'primary', onPress: confirmGift, loading: giftSaving, disabled: giftLoading || !giftSelectedIds.length },
      ]}
    >
      <Text style={styles.giftHint}>可选择一个或多个账号，已绑定用户较少的账号优先显示。</Text>
      <ScrollView style={styles.bindingList}>
        {giftLoading ? <View style={styles.sheetLoading}><ActivityIndicator color={COLORS.primary} /><Text style={styles.stateDescription}>正在读取官方账号池…</Text></View> : null}
        {!giftLoading && !giftAccounts.items.length ? <Text style={styles.inlineEmpty}>官方账号池暂无可赠送账号</Text> : null}
        {giftAccounts.items.map((account) => {
          const checked = giftSelectedIds.includes(account.id);
          return <Pressable
            key={account.id}
            onPress={() => setGiftSelectedIds((ids) => checked ? ids.filter((id) => id !== account.id) : [...ids, account.id])}
            style={({ pressed }) => [styles.checkRow, checked && styles.checkRowActive, pressed && styles.pressed]}
          >
            <View style={[styles.checkbox, checked && styles.checkboxChecked]}><Text style={styles.checkboxText}>{checked ? '✓' : ''}</Text></View>
            <View style={styles.checkCopy}>
              <Text style={styles.checkLabel} numberOfLines={1}>{account.email}</Text>
              <Text style={styles.checkMeta} numberOfLines={1}>{account.plan || 'ChatGPT'} · 已绑定 {account.boundUserCount} 人{account.note ? ` · ${account.note}` : ''}</Text>
            </View>
          </Pressable>;
        })}
        <Pager value={giftAccounts} onChange={(page) => void loadGiftAccounts(page)} />
      </ScrollView>
    </BottomSheet>

    <BottomSheet
      visible={Boolean(revoking)}
      title="撤销邀请"
      subtitle="撤销后注册链接会立即失效"
      onClose={() => setRevoking(null)}
      dismissible={!revokingBusy}
      actions={[
        { label: '取消', onPress: () => setRevoking(null), disabled: revokingBusy },
        { label: '确认撤销', tone: 'danger', onPress: confirmRevoke, loading: revokingBusy },
      ]}
    >
      <ConfirmCopy icon="×" title={revoking?.email || '任意邮箱邀请'} description="已经通过该链接注册的用户不会受到影响。" />
    </BottomSheet>
  </PageShell>;
}

function FeedbackPage({ session, profile, onBack }: AdminAreaProps & { onBack: () => void }) {
  const [data, setData] = useState<PageResult<AdminFeedback>>(EMPTY_PAGE);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AdminFeedback | null>(null);
  const [replying, setReplying] = useState<AdminFeedback | null>(null);
  const [subject, setSubject] = useState('Codex Switch 问题反馈回复');
  const [content, setContent] = useState('');
  const [replyingBusy, setReplyingBusy] = useState(false);
  const canManage = has(profile, 'admin.feedback.manage');
  const load = useCallback(async (page = data.page) => {
    setLoading(true);
    try { setData(await adminRequest(session, `/admin/api/feedback?page=${page}&pageSize=${data.pageSize}`)); }
    catch (error) { Toast.fail(messageOf(error)); }
    finally { setLoading(false); }
  }, [data.page, data.pageSize, session]);
  useEffect(() => { void load(1); }, [session]);

  function openReply(item: AdminFeedback) {
    setSubject('Codex Switch 问题反馈回复');
    setContent('');
    setReplying(item);
  }

  async function sendReply() {
    if (!replying || !subject.trim() || !content.trim()) { Toast.fail('请填写主题和回复内容'); return; }
    setReplyingBusy(true);
    try {
      await adminRequest(session, `/admin/api/feedback/${replying.id}/email`, { method: 'POST', body: JSON.stringify({ subject, content }) });
      Toast.success('回复邮件已发送');
      setReplying(null);
      setContent('');
      await load();
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setReplyingBusy(false); }
  }

  return <PageShell page="feedback" onBack={onBack}>
    <Toolbar total={data.total} loading={loading} onRefresh={() => void load()} />
    <ScrollView contentContainerStyle={styles.listScroll}>
      <LoadingOrEmpty loading={loading} empty={!data.items.length}>
        {data.items.map((item) => <Surface key={item.id}>
          <View style={styles.cardHeader}>
            <View style={[styles.avatar, { backgroundColor: COLORS.purpleSoft }]}><Text style={[styles.avatarText, { color: COLORS.purple }]}>馈</Text></View>
            <View style={styles.cardHeading}>
              <Text style={styles.cardTitle}>{item.email || '匿名用户'}</Text>
              <Text style={styles.cardSubtitle}>{formatDate(item.createdAt)}</Text>
            </View>
            <Pill tone={item.lastRepliedAt ? 'green' : 'amber'}>{item.lastRepliedAt ? '已回复' : '待回复'}</Pill>
          </View>
          <Text style={styles.feedbackContent} numberOfLines={3}>{item.content}</Text>
          <View style={styles.pillRow}>
            <Pill tone="blue">{item.platform}</Pill>
            <Pill tone="gray">v{item.version}</Pill>
            {item.attachments.length ? <Pill tone="purple">{item.attachments.length} 个附件</Pill> : null}
          </View>
          <View style={styles.cardActions}>
            <AdminButton label="查看详情" compact onPress={() => setSelected(item)} />
            {canManage && item.email ? <AdminButton label="邮件回复" tone="primary" compact onPress={() => openReply(item)} /> : null}
          </View>
        </Surface>)}
      </LoadingOrEmpty>
      <Pager value={data} onChange={(page) => void load(page)} />
    </ScrollView>

    <BottomSheet
      visible={Boolean(selected)}
      title="反馈详情"
      subtitle={selected ? `${selected.email || '匿名用户'} · ${selected.platform} · v${selected.version}` : undefined}
      onClose={() => setSelected(null)}
      tall
      actions={[{ label: '完成', tone: 'primary', onPress: () => setSelected(null) }]}
    >
      <ScrollView style={styles.sheetScroll}>
        <View style={styles.detailContentBox}><Text selectable style={styles.detailContent}>{selected?.content}</Text></View>
        {selected?.attachments.length ? <Text style={styles.sheetSectionLabel}>附件</Text> : null}
        {selected?.attachments.map((file) => <View key={file.id} style={styles.fileRow}>
          <View style={styles.fileIcon}><Text style={styles.fileIconText}>↗</Text></View>
          <View style={styles.fileCopy}><Text style={styles.fileName} numberOfLines={1}>{file.fileName}</Text><Text style={styles.fileMeta}>{file.mimeType}</Text></View>
          <Text style={styles.fileSize}>{(file.size / 1024 / 1024).toFixed(2)} MB</Text>
        </View>)}
      </ScrollView>
    </BottomSheet>

    <BottomSheet
      visible={Boolean(replying)}
      title="邮件回复"
      subtitle={replying?.email ?? undefined}
      onClose={() => setReplying(null)}
      dismissible={!replyingBusy}
      tall
      actions={[
        { label: '取消', onPress: () => setReplying(null), disabled: replyingBusy },
        { label: '发送回复', tone: 'primary', onPress: sendReply, loading: replyingBusy },
      ]}
    >
      <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
        <Field label="邮件主题" value={subject} onChangeText={setSubject} />
        <Field label="回复内容" value={content} onChangeText={setContent} multiline placeholder="输入对用户问题的回复…" />
      </ScrollView>
    </BottomSheet>
  </PageShell>;
}

function UsersPage({ session, profile, onBack }: AdminAreaProps & { onBack: () => void }) {
  const [data, setData] = useState<PageResult<AdminUser>>(EMPTY_PAGE);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [disabled, setDisabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const canManage = has(profile, 'admin.users.manage');

  const load = useCallback(async (page = data.page) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(data.pageSize) });
      if (search.trim()) query.set('search', search.trim());
      setData(await adminRequest(session, `/admin/api/users?${query}`));
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setLoading(false); }
  }, [data.page, data.pageSize, search, session]);
  useEffect(() => {
    void load(1);
    if (has(profile, 'admin.roles.read')) void adminRequest<AdminRole[]>(session, '/admin/api/roles').then(setRoles).catch(() => undefined);
  }, [session]);

  function openEditor(user: AdminUser | 'new') {
    setEditing(user);
    setEmail(user === 'new' ? '' : user.email);
    setPassword('');
    setRole(user === 'new' ? 'user' : user.role);
    setDisabled(user === 'new' ? false : user.disabled);
  }

  async function save() {
    if (!email.trim() || (editing === 'new' && password.length < 8) || (editing !== 'new' && password.length > 0 && password.length < 8)) {
      Toast.fail('请填写有效邮箱，密码至少 8 位');
      return;
    }
    setSaving(true);
    try {
      const body = { email: email.trim(), role, disabled, ...(password ? { password } : {}) };
      await adminRequest(session, editing === 'new' ? '/admin/api/users' : `/admin/api/users/${editing?.id}`, {
        method: editing === 'new' ? 'POST' : 'PATCH',
        body: JSON.stringify(body),
      });
      Toast.success(editing === 'new' ? '用户已创建' : '用户已更新');
      const firstPage = editing === 'new';
      setEditing(null);
      await load(firstPage ? 1 : data.page);
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setSaving(false); }
  }

  async function confirmRemove() {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await adminRequest(session, `/admin/api/users/${deleting.id}`, { method: 'DELETE' });
      Toast.success('用户已删除');
      setDeleting(null);
      await load();
    } catch (error) { Toast.fail(messageOf(error)); }
    finally { setDeletingBusy(false); }
  }

  return <PageShell page="users" onBack={onBack}>
    <SearchBar value={search} onChangeText={setSearch} onSearch={() => void load(1)} placeholder="搜索用户邮箱" />
    <Toolbar total={data.total} loading={loading} onRefresh={() => void load()}>
      {canManage ? <AdminButton label="＋ 新增" tone="primary" compact onPress={() => openEditor('new')} /> : null}
    </Toolbar>
    <ScrollView contentContainerStyle={styles.listScroll} keyboardShouldPersistTaps="handled">
      <LoadingOrEmpty loading={loading} empty={!data.items.length}>
        {data.items.map((user) => <Surface key={user.id}>
          <View style={styles.cardHeader}>
            <View style={[styles.avatar, { backgroundColor: user.disabled ? COLORS.redSoft : COLORS.blueSoft }]}>
              <Text style={[styles.avatarText, { color: user.disabled ? COLORS.red : COLORS.blue }]}>{user.email.slice(0, 2).toUpperCase()}</Text>
            </View>
            <View style={styles.cardHeading}>
              <Text style={styles.cardTitle} numberOfLines={1}>{user.email}</Text>
              <Text style={styles.cardSubtitle}>最后登录 {formatDate(user.lastLoginAt)}</Text>
            </View>
            <Pill tone={user.disabled ? 'red' : 'green'}>{user.disabled ? '已禁用' : '正常'}</Pill>
          </View>
          <View style={styles.pillRow}><Pill tone="purple">{roles.find((item) => item.code === user.role)?.name ?? user.role}</Pill></View>
          {canManage ? <View style={styles.cardActions}>
            <AdminButton label="编辑用户" compact onPress={() => openEditor(user)} />
            <AdminButton label="删除" tone="quiet" compact onPress={() => setDeleting(user)} />
          </View> : null}
        </Surface>)}
      </LoadingOrEmpty>
      <Pager value={data} onChange={(page) => void load(page)} />
    </ScrollView>

    <BottomSheet
      visible={Boolean(editing)}
      title={editing === 'new' ? '新增用户' : '编辑用户'}
      subtitle={editing === 'new' ? '创建一个新的云端用户' : editing ? editing.email : undefined}
      onClose={() => setEditing(null)}
      dismissible={!saving}
      tall
      actions={[
        { label: '取消', onPress: () => setEditing(null), disabled: saving },
        { label: '保存用户', tone: 'primary', onPress: save, loading: saving },
      ]}
    >
      <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
        <Field label="邮箱" value={email} onChangeText={setEmail} keyboardType="email-address" placeholder="name@example.com" />
        <Field label={editing === 'new' ? '初始密码' : '重置密码（可选）'} value={password} onChangeText={setPassword} secureTextEntry placeholder={editing === 'new' ? '至少 8 位' : '留空表示不修改'} />
        <Text style={styles.fieldLabel}>角色</Text>
        <View style={styles.choiceRow}>
          {(roles.length ? roles : [{ code: 'user', name: '用户' } as AdminRole]).map((item) => <Pressable
            key={item.code}
            onPress={() => setRole(item.code)}
            style={[styles.choiceChip, role === item.code && styles.choiceChipActive]}
          >
            <Text style={[styles.choiceChipText, role === item.code && styles.choiceChipTextActive]}>{item.name}</Text>
          </Pressable>)}
        </View>
        <SwitchRow label="禁用用户" description="禁用后该用户将无法登录" value={disabled} onValueChange={setDisabled} />
      </ScrollView>
    </BottomSheet>

    <BottomSheet
      visible={Boolean(deleting)}
      title="删除用户"
      subtitle="此操作无法撤销"
      onClose={() => setDeleting(null)}
      dismissible={!deletingBusy}
      actions={[
        { label: '取消', onPress: () => setDeleting(null), disabled: deletingBusy },
        { label: '永久删除', tone: 'danger', onPress: confirmRemove, loading: deletingBusy },
      ]}
    >
      <ConfirmCopy icon="!" title={deleting?.email ?? ''} description="该用户的登录权限与相关数据将被永久移除。" />
    </BottomSheet>
  </PageShell>;
}

export function AdminArea({ session, profile }: AdminAreaProps) {
  const [page, setPage] = useState<AdminPage>('home');
  const props = useMemo(() => ({ session, profile, onBack: () => setPage('home') }), [profile, session]);
  if (page === 'home') return <AdminHome profile={profile} onOpen={setPage} />;
  if (page === 'dashboard') return <DashboardPage {...props} />;
  if (page === 'officialAccounts') return <OfficialAccountsPage {...props} />;
  if (page === 'invitations') return <InvitationsPage {...props} />;
  if (page === 'feedback') return <FeedbackPage {...props} />;
  return <UsersPage {...props} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.76 },
  disabled: { opacity: 0.5 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14, backgroundColor: COLORS.canvas },
  backButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  backArrow: { color: COLORS.ink, fontSize: 30, lineHeight: 32, marginTop: -3 },
  pageHeading: { flex: 1 },
  pageTitle: { color: COLORS.ink, fontSize: 21, lineHeight: 27, fontWeight: '800' },
  pageSubtitle: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  homeScroll: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 36 },
  hero: { borderRadius: 24, backgroundColor: COLORS.primaryDark, padding: 22, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 },
  heroMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#b7ef5d', alignItems: 'center', justifyContent: 'center' },
  heroMarkText: { color: COLORS.primaryDark, fontSize: 13, fontWeight: '900', letterSpacing: 0.5 },
  heroEyebrow: { color: '#99b6aa', fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },
  heroTitle: { color: '#ffffff', fontSize: 30, lineHeight: 38, fontWeight: '900', marginTop: 5 },
  heroSubtitle: { color: '#c2d3cb', fontSize: 14, lineHeight: 21, marginTop: 7 },
  heroIdentity: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7, marginTop: 22, maxWidth: '100%' },
  heroDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#85ddb8' },
  heroIdentityText: { color: '#dce9e3', fontSize: 12, flexShrink: 1 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 28, marginBottom: 12, paddingHorizontal: 2 },
  sectionTitle: { color: COLORS.ink, fontSize: 19, fontWeight: '800' },
  sectionCaption: { color: COLORS.faint, fontSize: 12 },
  entryList: { gap: 10 },
  entryCard: { minHeight: 82, flexDirection: 'row', alignItems: 'center', borderRadius: 18, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 14, shadowColor: '#173128', shadowOpacity: 0.035, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  entryIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  entryIconText: { fontSize: 17, fontWeight: '900' },
  entryCopy: { flex: 1, minWidth: 0, marginLeft: 13 },
  entryTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '800' },
  entrySubtitle: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  entryArrow: { width: 32, height: 32, borderRadius: 11, backgroundColor: COLORS.canvas, alignItems: 'center', justifyContent: 'center' },
  entryArrowText: { color: COLORS.muted, fontSize: 23, lineHeight: 25, marginTop: -2 },
  toolbar: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, gap: 12 },
  toolbarEyebrow: { color: COLORS.faint, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  toolbarCount: { color: COLORS.ink, fontSize: 15, fontWeight: '800', marginTop: 2 },
  toolbarActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  button: { minHeight: 42, borderRadius: 13, backgroundColor: '#edf2ef', borderWidth: 1, borderColor: '#e2e9e5', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonCompact: { minHeight: 36, borderRadius: 11, paddingHorizontal: 13 },
  buttonPrimary: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  buttonDanger: { backgroundColor: COLORS.red, borderColor: COLORS.red },
  buttonQuiet: { backgroundColor: 'transparent', borderColor: COLORS.redSoft },
  buttonText: { color: COLORS.ink, fontSize: 13, fontWeight: '800' },
  buttonTextOnColor: { color: '#ffffff' },
  buttonTextQuiet: { color: COLORS.red },
  pill: { alignSelf: 'flex-start', minHeight: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '800' },
  pageScroll: { paddingHorizontal: 18, paddingBottom: 32 },
  listScroll: { paddingHorizontal: 18, paddingBottom: 32, gap: 11 },
  surface: { backgroundColor: COLORS.surface, borderRadius: 19, borderWidth: 1, borderColor: COLORS.border, padding: 16, marginBottom: 11, shadowColor: '#173128', shadowOpacity: 0.035, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  segmented: { flexDirection: 'row', backgroundColor: '#e8eeea', padding: 4, borderRadius: 14, marginBottom: 14 },
  segment: { flex: 1, minHeight: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: COLORS.surface, shadowColor: '#203d32', shadowOpacity: 0.08, shadowRadius: 5, elevation: 2 },
  segmentText: { color: COLORS.muted, fontSize: 13, fontWeight: '700' },
  segmentTextActive: { color: COLORS.ink, fontWeight: '900' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 2 },
  metricCard: { width: '48%', minHeight: 138, borderRadius: 18, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, padding: 15 },
  metricAccent: { width: 27, height: 27, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  metricAccentDot: { width: 8, height: 8, borderRadius: 4 },
  metricLabel: { color: COLORS.muted, fontSize: 12, fontWeight: '700' },
  metricValue: { color: COLORS.ink, fontSize: 28, lineHeight: 34, fontWeight: '900', marginTop: 3 },
  metricNote: { color: COLORS.faint, fontSize: 10, marginTop: 4 },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 16 },
  panelTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '900' },
  panelSubtitle: { color: COLORS.faint, fontSize: 11, marginTop: 3 },
  chartRow: { flexDirection: 'row', alignItems: 'center', minHeight: 31, gap: 9 },
  chartLabel: { width: 38, color: COLORS.muted, fontSize: 10 },
  chartTrack: { flex: 1, height: 8, backgroundColor: '#e8efeb', borderRadius: 5, overflow: 'hidden' },
  chartFill: { height: '100%', borderRadius: 5, backgroundColor: COLORS.primary },
  chartValue: { width: 30, textAlign: 'right', color: COLORS.ink, fontSize: 10, fontWeight: '800' },
  distributionRow: { marginBottom: 14 },
  distributionMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 7 },
  distributionName: { color: COLORS.ink, fontSize: 12, fontWeight: '700' },
  distributionValue: { color: COLORS.muted, fontSize: 12, fontWeight: '800' },
  distributionTrack: { height: 7, backgroundColor: '#e8efeb', borderRadius: 5, overflow: 'hidden' },
  distributionFill: { height: '100%', borderRadius: 5 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 2 },
  searchInputWrap: { flex: 1, height: 44, flexDirection: 'row', alignItems: 'center', borderRadius: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 12 },
  searchIcon: { color: COLORS.faint, fontSize: 22, marginRight: 8, marginTop: -2 },
  searchInput: { flex: 1, height: '100%', color: COLORS.ink, fontSize: 14, paddingVertical: 0 },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '900' },
  cardHeading: { flex: 1, minWidth: 0, marginLeft: 11, marginRight: 8 },
  cardTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '900' },
  cardSubtitle: { color: COLORS.faint, fontSize: 10, marginTop: 4 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 },
  bodyText: { color: '#405249', fontSize: 13, lineHeight: 20, marginTop: 12 },
  placeholderText: { color: COLORS.faint, fontStyle: 'italic' },
  cardFootnote: { color: COLORS.muted, fontSize: 11, marginTop: 12 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border, paddingTop: 13, marginTop: 14 },
  infoGrid: { flexDirection: 'row', gap: 9, marginTop: 14 },
  infoCell: { flex: 1, borderRadius: 13, backgroundColor: COLORS.canvas, padding: 11 },
  infoCellLabel: { color: COLORS.faint, fontSize: 10 },
  infoCellValue: { color: COLORS.ink, fontSize: 14, fontWeight: '900', marginTop: 4 },
  feedbackContent: { color: '#30443a', fontSize: 14, lineHeight: 21, marginTop: 14 },
  stateBox: { alignItems: 'center', paddingVertical: 62 },
  stateIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  stateIconText: { color: COLORS.primary, fontSize: 20, fontWeight: '800' },
  stateTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '800' },
  stateDescription: { color: COLORS.faint, fontSize: 11, marginTop: 5 },
  inlineEmpty: { color: COLORS.faint, fontSize: 12, textAlign: 'center', paddingVertical: 24 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 7 },
  pageBadge: { minWidth: 58, minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  pageBadgeText: { color: COLORS.muted, fontSize: 12, fontWeight: '700' },
  field: { marginBottom: 16 },
  fieldLabel: { color: COLORS.ink, fontWeight: '800', fontSize: 13, marginBottom: 8 },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#d6e0da', borderRadius: 13, color: COLORS.ink, backgroundColor: '#f9fbfa', paddingHorizontal: 13, paddingVertical: 11, fontSize: 14 },
  textarea: { minHeight: 130, lineHeight: 21 },
  fieldHint: { color: COLORS.faint, fontSize: 10, lineHeight: 15, marginTop: 6 },
  switchRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, backgroundColor: COLORS.canvas, paddingHorizontal: 13, marginBottom: 16 },
  switchCopy: { flex: 1, marginRight: 12 },
  switchLabel: { color: COLORS.ink, fontSize: 13, fontWeight: '800' },
  switchDescription: { color: COLORS.faint, fontSize: 10, marginTop: 3 },
  sheetScroll: { maxHeight: 510 },
  bindingList: { maxHeight: 510 },
  sheetLoading: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 8 },
  checkRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 12, marginBottom: 8 },
  checkRowActive: { borderColor: '#99d8c8', backgroundColor: '#f0faf6' },
  checkbox: { width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: '#b2c1b9', alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  checkboxText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  checkCopy: { flex: 1, marginLeft: 11 },
  checkLabel: { color: COLORS.ink, fontSize: 13, fontWeight: '800' },
  checkMeta: { color: COLORS.faint, fontSize: 10, marginTop: 3 },
  confirmBox: { alignItems: 'center', borderRadius: 17, backgroundColor: COLORS.canvas, padding: 20 },
  confirmIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  confirmIconText: { fontSize: 21, fontWeight: '900' },
  confirmTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '900', textAlign: 'center' },
  confirmDescription: { color: COLORS.muted, fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 7 },
  personRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border, paddingVertical: 9 },
  miniAvatar: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  miniAvatarText: { fontSize: 11, fontWeight: '900' },
  personCopy: { flex: 1, minWidth: 0, marginLeft: 10, marginRight: 7 },
  personName: { color: COLORS.ink, fontSize: 12, fontWeight: '800' },
  personMeta: { color: COLORS.faint, fontSize: 10, marginTop: 3 },
  personActions: { alignItems: 'flex-end', gap: 7 },
  giftHint: { color: COLORS.muted, fontSize: 11, lineHeight: 17, marginBottom: 12 },
  detailContentBox: { borderRadius: 15, backgroundColor: COLORS.canvas, padding: 15, marginBottom: 18 },
  detailContent: { color: '#2d4137', fontSize: 14, lineHeight: 23 },
  sheetSectionLabel: { color: COLORS.faint, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  fileRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  fileIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: COLORS.purpleSoft, alignItems: 'center', justifyContent: 'center' },
  fileIconText: { color: COLORS.purple, fontSize: 15, fontWeight: '900' },
  fileCopy: { flex: 1, minWidth: 0, marginHorizontal: 10 },
  fileName: { color: COLORS.ink, fontSize: 12, fontWeight: '800' },
  fileMeta: { color: COLORS.faint, fontSize: 9, marginTop: 3 },
  fileSize: { color: COLORS.muted, fontSize: 10 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 17 },
  choiceChip: { minHeight: 38, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.canvas, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  choiceChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primarySoft },
  choiceChipText: { color: COLORS.muted, fontSize: 12, fontWeight: '800' },
  choiceChipTextActive: { color: COLORS.primary },
});
