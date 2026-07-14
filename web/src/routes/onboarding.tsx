import { createFileRoute } from '@tanstack/react-router';
import {
  AlertDialog,
  Banner,
  Button,
  EmptyState,
  FormLayout,
  HStack,
  List,
  ListItem,
  Spinner,
  StatusDot,
  Table,
  Text,
  TextInput,
  VStack,
  type TableColumn,
} from '@astryxdesign/core';
import { proportional } from '@astryxdesign/core/Table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { z } from 'zod';
import { DefinitionList, PageHeader, PageStack, SurfaceSection } from '../components/Page.js';
import {
  accountSchema,
  configureAccount,
  createAccount,
  deleteAccount,
  getAccountStatus,
  getAccounts,
  getCurrentOperator,
  updateAccount,
} from '../lib/api.js';
import { requireWebSession } from '../route-guards.js';

type AccountRecord = z.infer<typeof accountSchema>;

export const Route = createFileRoute('/onboarding')({
  beforeLoad: requireWebSession,
  component: OnboardingPage,
});

function OnboardingPage() {
  const queryClient = useQueryClient();
  const current = useQuery({
    queryKey: ['current-operator'],
    queryFn: getCurrentOperator,
  });
  const tenantId = current.data?.defaultTenantId;
  const accounts = useQuery({
    queryKey: ['accounts', tenantId],
    queryFn: async () => await getAccounts(tenantId!),
    enabled: Boolean(tenantId),
  });
  const rows = accounts.data?.accounts ?? [];
  const [selectedAccountId, setSelectedAccountId] = useState<string>();
  const [newResourceName, setNewResourceName] = useState('新的微信公众号资源');
  const selectedAccount = rows.find(account => account.accountId === selectedAccountId)
    ?? rows.find(account => account.accountId === current.data?.defaultAccountId)
    ?? rows.find(account => account.isDefault)
    ?? rows[0];
  const canWrite = current.data?.scopes.length
    ? current.data.scopes.includes('woa:account:write')
    : true;
  const resourceError = current.error ?? accounts.error;
  const isResourceLoading = current.isLoading || (Boolean(tenantId) && accounts.isLoading);
  const hasNoTenant = !current.isLoading && !current.error && !tenantId;

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error('当前用户尚无可用工作空间。');
      const name = newResourceName.trim();
      if (!name) throw new Error('请填写公众号资源名称。');
      return await createAccount({ tenantId, name });
    },
    onSuccess: async account => {
      setNewResourceName('新的微信公众号资源');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['accounts', tenantId] }),
        queryClient.invalidateQueries({ queryKey: ['current-operator'] }),
        queryClient.invalidateQueries({ queryKey: ['onboarding'] }),
      ]);
      setSelectedAccountId(account.accountId);
      focusAccountEditor();
    },
  });

  function focusNewResourceForm() {
    const input = document.querySelector<HTMLInputElement>('input[name="newResourceName"]');
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input?.focus({ preventScroll: true });
  }

  function selectAccount(accountId: string) {
    setSelectedAccountId(accountId);
    focusAccountEditor();
  }

  function focusAccountEditor() {
    window.setTimeout(() => {
      const editor = document.querySelector<HTMLElement>('[data-account-editor]');
      editor?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      editor?.focus({ preventScroll: true });
    }, 0);
  }

  async function retryResources() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['current-operator'] }),
      queryClient.invalidateQueries({ queryKey: ['accounts', tenantId] }),
    ]);
  }

  const columns: TableColumn<AccountRecord>[] = [
    {
      key: 'resource',
      header: '公众号资源',
      width: proportional(1.35),
      renderCell: account => (
        <VStack gap={1}>
          <Text weight="semibold">{account.name ?? account.accountName ?? '未命名资源'}</Text>
          <Text type="supporting">
            <span className="mono">{account.accountId}</span>{account.isDefault ? ' · 默认资源' : ''}
          </Text>
        </VStack>
      ),
    },
    {
      key: 'appId',
      header: 'AppID',
      width: proportional(1),
      renderCell: account => account.appId ? <span className="mono">{account.appId}</span> : '未配置',
    },
    {
      key: 'status',
      header: '授权状态',
      width: proportional(0.8),
      renderCell: account => {
        const configured = isAccountConfigured(account);
        return (
          <HStack gap={2} as="span" vAlign="center">
            <StatusDot variant={configured ? 'success' : 'warning'} label={configured ? '授权有效' : '等待配置'} />
            <Text>{configured ? '已验证' : '未配置'}</Text>
          </HStack>
        );
      },
    },
    {
      key: 'actions',
      header: '操作',
      width: proportional(0.6),
      renderCell: account => (
        selectedAccount?.accountId === account.accountId ? (
          <Text type="supporting">当前管理</Text>
        ) : (
          <Button
            label="管理"
            size="sm"
            variant="ghost"
            clickAction={() => selectAccount(account.accountId)}
          />
        )
      ),
    },
  ];

  function submitNewResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="onboarding-layout">
      <div className="onboarding-main">
        <PageHeader
          eyebrow="接入设置"
          title="公众号连接"
          description="选择要管理的公众号，验证或更新 AppID/AppSecret，并查看当前连接状态。"
        />
        <PageStack>
          {!canWrite ? (
            <Banner
              status="warning"
              title="当前为只读访问"
              description="你可以查看连接状态，但创建、更新和删除公众号需要 woa:account:write 权限。"
              container="section"
            />
          ) : null}
          <SurfaceSection title="公众号资源">
            {isResourceLoading ? (
              <Spinner label="正在读取当前工作空间与公众号资源…" />
            ) : resourceError ? (
              <Banner
                status="error"
                title="无法读取公众号资源"
                description={errorMessage(resourceError, '读取公众号资源失败，请重试。')}
                endContent={<Button label="重新加载" size="sm" clickAction={retryResources} />}
              />
            ) : hasNoTenant ? (
              <Banner
                status="warning"
                title="当前账户没有可用工作空间"
                description="请联系管理员将你加入工作空间，然后重新加载页面。"
                endContent={<Button label="重新加载" size="sm" clickAction={retryResources} />}
              />
            ) : rows.length === 0 ? (
              <EmptyState
                title="还没有连接公众号"
                description="先填写一个便于识别的公众号名称，再提交 AppID/AppSecret 完成连接。"
                actions={<Button label="填写公众号名称" clickAction={focusNewResourceForm} isDisabled={!canWrite} tooltip={!canWrite ? '需要公众号写入权限' : undefined} />}
                isCompact
              />
            ) : (
              <>
                <div className="responsive-table-desktop">
                  <Table data={rows} idKey="accountId" columns={columns} dividers="rows" hasHover textOverflow="wrap" />
                </div>
                <div className="responsive-list-mobile">
                  <List header="公众号资源" hasDividers density="compact">
                    {rows.map(account => {
                      const configured = isAccountConfigured(account);
                      const isSelected = selectedAccount?.accountId === account.accountId;
                      return (
                        <ListItem
                          key={account.accountId}
                          label={account.name ?? account.accountName ?? '未命名资源'}
                          description={(
                            <VStack gap={1}>
                              <Text type="supporting"><span className="mono">{account.appId ?? 'AppID 未配置'}</span></Text>
                              <HStack gap={2} vAlign="center">
                                <StatusDot variant={configured ? 'success' : 'warning'} label={configured ? '授权有效' : '等待配置'} />
                                <Text type="supporting">{configured ? '已验证' : '未配置'}{account.isDefault ? ' · 默认资源' : ''}</Text>
                              </HStack>
                              {isSelected ? (
                                <Text type="supporting">当前正在管理</Text>
                              ) : (
                                <div className="responsive-row-action">
                                  <Button label="管理此公众号" size="sm" clickAction={() => selectAccount(account.accountId)} />
                                </div>
                              )}
                            </VStack>
                          )}
                        />
                      );
                    })}
                  </List>
                </div>
              </>
            )}
          </SurfaceSection>

          {!resourceError && tenantId ? <SurfaceSection title="新增公众号">
            <form onSubmit={submitNewResource}>
              <FormLayout>
                <TextInput
                  label="公众号名称"
                  htmlName="newResourceName"
                  value={newResourceName}
                  onChange={value => {
                    setNewResourceName(value);
                    createMutation.reset();
                  }}
                  description="仅用于当前工作空间内识别，不会同步到微信公众平台。创建后再配置 AppID/AppSecret。"
                  isRequired
                  isDisabled={!canWrite}
                  disabledMessage="需要公众号写入权限"
                />
              </FormLayout>
              <div className="inline-actions">
                <Button
                  label="创建公众号连接"
                  type="submit"
                  variant="primary"
                  isLoading={createMutation.isPending}
                  isDisabled={!tenantId || !canWrite || !newResourceName.trim()}
                  tooltip={!canWrite ? '需要公众号写入权限' : undefined}
                />
              </div>
            </form>
            {createMutation.isSuccess ? <p className="auth-success" role="status">公众号已创建，请继续填写连接凭据。</p> : null}
            {createMutation.error ? (
              <p className="form-error" role="alert">{errorMessage(createMutation.error, '创建公众号资源失败。')}</p>
            ) : null}
          </SurfaceSection> : null}

          {tenantId && selectedAccount ? (
            <div data-account-editor tabIndex={-1} className="account-editor">
              <AccountAuthorizationEditor
                key={selectedAccount.accountId}
                tenantId={tenantId}
                account={selectedAccount}
                canWrite={canWrite}
                onDeleted={() => setSelectedAccountId(undefined)}
              />
            </div>
          ) : null}
        </PageStack>
      </div>

      <aside className="onboarding-guidance" aria-label="授权信息说明">
        <VStack gap={3}>
          <Text type="large" weight="semibold">密钥处理规则</Text>
          <Text type="supporting" as="p" textWrap="pretty">
            Web 端只显示 AppID 和密钥是否已配置。AppSecret、Webhook Token 与 EncodingAESKey 不会显示原值。
          </Text>
          <ul className="notice-list">
            <li>AppID/AppSecret 通过微信接口验证后才会保存。</li>
            <li>更新 AppID/AppSecret 时，留空的 Webhook 字段会保留现值。</li>
            <li>删除资源会清除 AppSecret、Webhook 凭据和缓存访问令牌。</li>
            <li>微信提示 IP 白名单错误时，请将服务出口 IP 加入白名单。</li>
          </ul>
        </VStack>
      </aside>
    </div>
  );
}

function AccountAuthorizationEditor({
  tenantId,
  account,
  canWrite,
  onDeleted,
}: {
  tenantId: string;
  account: AccountRecord;
  canWrite: boolean;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [resourceName, setResourceName] = useState(account.name ?? account.accountName ?? '未命名资源');
  const [appId, setAppId] = useState(account.appId ?? '');
  const [appSecret, setAppSecret] = useState('');
  const [webhookToken, setWebhookToken] = useState('');
  const [encodingAESKey, setEncodingAESKey] = useState('');
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const status = useQuery({
    queryKey: ['account-status', tenantId, account.accountId],
    queryFn: async () => await getAccountStatus(tenantId, account.accountId),
  });

  async function invalidateAccountState() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['accounts', tenantId] }),
      queryClient.invalidateQueries({ queryKey: ['account-status', tenantId, account.accountId] }),
      queryClient.invalidateQueries({ queryKey: ['current-operator'] }),
      queryClient.invalidateQueries({ queryKey: ['onboarding'] }),
    ]);
  }

  const renameMutation = useMutation({
    mutationFn: async () => {
      const name = resourceName.trim();
      if (!name) throw new Error('请填写公众号资源名称。');
      return await updateAccount({ tenantId, accountId: account.accountId, name });
    },
    onSuccess: async updated => {
      setResourceName(updated.name ?? resourceName.trim());
      await invalidateAccountState();
    },
  });
  const defaultMutation = useMutation({
    mutationFn: async () => await updateAccount({ tenantId, accountId: account.accountId, isDefault: true }),
    onSuccess: invalidateAccountState,
  });
  const configureMutation = useMutation({
    mutationFn: async () => {
      if (!appId.trim() || !appSecret) throw new Error('AppID 和 AppSecret 均为必填项。');
      return await configureAccount({
        tenantId,
        accountId: account.accountId,
        appId: appId.trim(),
        appSecret,
        token: webhookToken,
        encodingAESKey,
      });
    },
    onSuccess: async updated => {
      setAppId(updated.appId ?? appId.trim());
      setAppSecret('');
      setWebhookToken('');
      setEncodingAESKey('');
      await invalidateAccountState();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: async () => await deleteAccount({ tenantId, accountId: account.accountId }),
    onSuccess: async () => {
      setIsDeleteOpen(false);
      await invalidateAccountState();
      onDeleted();
    },
  });

  const config = status.data?.config;
  const recordedConfigured = isAccountConfigured(account);
  const configured = status.data?.configured ?? recordedConfigured;
  const connectionState = status.isLoading
    ? { variant: 'neutral' as const, label: '正在确认授权状态', text: '正在确认当前连接' }
    : status.error
      ? { variant: 'warning' as const, label: '当前状态无法确认', text: recordedConfigured ? '上次记录已启用，当前无法确认' : '当前授权状态无法确认' }
      : configured
        ? { variant: 'success' as const, label: '授权有效', text: '已验证并启用' }
        : { variant: 'warning' as const, label: '等待配置', text: '等待 AppID/AppSecret' };
  const currentAppId = config?.appId ?? account.appId;
  const hasAppSecret = config?.hasAppSecret ?? account.hasAppSecret ?? false;
  const hasWebhookToken = config?.hasToken ?? account.hasWebhookToken ?? false;
  const hasEncodingAESKey = config?.hasEncodingAESKey ?? account.hasEncodingAESKey ?? false;

  function submitResourceSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    renameMutation.mutate();
  }

  function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    configureMutation.mutate();
  }

  return (
    <>
      <SurfaceSection title="当前连接状态" tone={!status.error && !status.isLoading && configured ? 'accent' : 'default'}>
        <DefinitionList columns="multi" items={[
          { label: '公众号名称', value: account.name ?? account.accountName ?? '未命名公众号' },
          { label: '连接 ID', value: <span className="mono">{account.accountId}</span> },
          {
            label: '授权状态',
            value: (
              <HStack gap={2} as="span" vAlign="center">
                <StatusDot variant={connectionState.variant} label={connectionState.label} />
                <Text>{connectionState.text}</Text>
              </HStack>
            ),
          },
          { label: 'AppID', value: currentAppId ? <span className="mono">{currentAppId}</span> : '未配置' },
          { label: 'AppSecret', value: hasAppSecret ? '已加密保存' : '未配置' },
          { label: 'Webhook Token', value: hasWebhookToken ? '已加密保存' : '未配置' },
          { label: 'EncodingAESKey', value: hasEncodingAESKey ? '已加密保存' : '未配置' },
          { label: '默认公众号', value: account.isDefault ? '是' : '否' },
          { label: '最后更新', value: formatTime(account.updatedAt) },
        ]} />
        {status.error ? (
          <Banner
            status="warning"
            title="无法确认实时授权状态"
            description={errorMessage(status.error, '当前显示的是上次保存的配置记录，请稍后重试。')}
            endContent={<Button label="重新检查" size="sm" clickAction={async () => { await status.refetch(); }} />}
          />
        ) : null}
      </SurfaceSection>

      <SurfaceSection title={configured ? '更新公众号凭据' : '连接公众号凭据'}>
        <form className="credential-form" onSubmit={submitCredentials}>
          <Banner
            status="info"
            title="提交前检查"
            description="AppID/AppSecret 验证成功后才会保存。若微信提示 IP 白名单错误，请先将服务出口 IP 加入公众号白名单。"
          />
          <FormLayout>
            <TextInput
              label="AppID"
              htmlName="appId"
              value={appId}
              onChange={value => {
                setAppId(value);
                configureMutation.reset();
              }}
              placeholder="wx..."
              isRequired
              isDisabled={!canWrite}
              disabledMessage="需要公众号写入权限"
            />
            <TextInput
              label="AppSecret"
              htmlName="appSecret"
              type="password"
              value={appSecret}
              onChange={value => {
                setAppSecret(value);
                configureMutation.reset();
              }}
              description={configured ? '系统不会显示现有值；更新连接时必须重新输入。' : '只发送到受保护的服务端，不保存在浏览器。'}
              isRequired
              isDisabled={!canWrite}
              disabledMessage="需要公众号写入权限"
            />
            <TextInput
              label="Webhook Token"
              htmlName="token"
              value={webhookToken}
              onChange={value => {
                setWebhookToken(value);
                configureMutation.reset();
              }}
              description={hasWebhookToken ? '已配置；留空会保留现有值，填写后替换。' : '可选；启用收件箱和入站消息前配置。'}
              isOptional
              isDisabled={!canWrite}
              disabledMessage="需要公众号写入权限"
            />
            <TextInput
              label="EncodingAESKey"
              htmlName="encodingAESKey"
              value={encodingAESKey}
              onChange={value => {
                setEncodingAESKey(value);
                configureMutation.reset();
              }}
              description={hasEncodingAESKey ? '已配置；留空会保留现有值，填写后替换。' : '可选；微信安全模式回调需要。'}
              isOptional
              isDisabled={!canWrite}
              disabledMessage="需要公众号写入权限"
            />
          </FormLayout>
          <div className="inline-actions">
            <Button
              label={configured ? '验证并更新授权' : '验证并保存授权'}
              type="submit"
              variant="primary"
              isLoading={configureMutation.isPending}
              isDisabled={!canWrite || !appId.trim() || !appSecret}
              tooltip={!canWrite ? '需要公众号写入权限' : undefined}
            />
          </div>
        </form>
        {configureMutation.isSuccess ? <p className="auth-success" role="status">公众号授权信息已验证并保存。</p> : null}
        {configureMutation.error ? (
          <p className="form-error" role="alert">
            {errorMessage(configureMutation.error, '凭据验证失败，请确认 AppID、AppSecret 和微信 IP 白名单。')}
          </p>
        ) : null}
      </SurfaceSection>

      <SurfaceSection title="公众号名称与默认设置">
        <form onSubmit={submitResourceSettings}>
          <FormLayout>
            <TextInput
              label="公众号名称"
              htmlName="resourceName"
              value={resourceName}
              onChange={value => {
                setResourceName(value);
                renameMutation.reset();
              }}
              description="名称仅用于当前工作空间内识别，不会同步到微信公众平台。"
              isRequired
              isDisabled={!canWrite}
              disabledMessage="需要公众号写入权限"
            />
          </FormLayout>
          <div className="inline-actions">
            <Button
              label="保存名称"
              type="submit"
              isLoading={renameMutation.isPending}
              isDisabled={!canWrite || !resourceName.trim()}
              tooltip={!canWrite ? '需要公众号写入权限' : undefined}
            />
            {account.isDefault ? (
              <Text type="supporting">当前默认公众号</Text>
            ) : (
              <Button
                label="设为默认公众号"
                variant="ghost"
                isLoading={defaultMutation.isPending}
                isDisabled={!canWrite}
                tooltip={!canWrite ? '需要公众号写入权限' : undefined}
                clickAction={() => defaultMutation.mutate()}
              />
            )}
          </div>
        </form>
        {renameMutation.isSuccess ? <p className="auth-success" role="status">公众号名称已保存。</p> : null}
        {defaultMutation.isSuccess ? <p className="auth-success" role="status">已设为默认公众号。</p> : null}
        {renameMutation.error || defaultMutation.error ? (
          <p className="form-error" role="alert">
            {errorMessage(renameMutation.error ?? defaultMutation.error, '更新公众号资源失败。')}
          </p>
        ) : null}
      </SurfaceSection>

      <SurfaceSection title="删除公众号连接" tone="quiet">
        <VStack gap={3}>
          <Text type="supporting" as="p" textWrap="pretty">
            删除后公众号连接会停用，AppSecret、Webhook Token、EncodingAESKey 和缓存访问令牌会被清除；历史审计记录保留。
            {account.isDefault ? ' 这是当前默认公众号，删除后需要重新选择默认公众号。' : ''}
          </Text>
          <div className="inline-actions">
            <Button
              label="删除当前公众号连接"
              variant="destructive"
              isDisabled={!canWrite}
              tooltip={!canWrite ? '需要公众号写入权限' : undefined}
              clickAction={() => setIsDeleteOpen(true)}
            />
          </div>
          {deleteMutation.error ? (
            <p className="form-error" role="alert">{errorMessage(deleteMutation.error, '删除公众号资源失败。')}</p>
          ) : null}
        </VStack>
      </SurfaceSection>

      <AlertDialog
        isOpen={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        title={`删除“${account.name ?? account.accountId}”？`}
        description={`该操作会停用公众号连接并永久清除相关密钥与缓存访问令牌。历史审计记录不会删除。${account.isDefault ? ' 删除后需要重新选择默认公众号。' : ''}`}
        cancelLabel="取消"
        actionLabel="删除公众号连接与密钥"
        isActionLoading={deleteMutation.isPending}
        onAction={() => deleteMutation.mutate()}
      />
    </>
  );
}

function isAccountConfigured(account: AccountRecord): boolean {
  return account.status === 'active' && account.hasAppSecret === true;
}

function formatTime(value: number | undefined): string {
  if (!value) return '—';
  const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString('zh-CN', { hour12: false });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
