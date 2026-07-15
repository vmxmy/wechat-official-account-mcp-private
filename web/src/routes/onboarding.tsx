import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  AlertDialog,
  Banner,
  Button,
  Card,
  Dialog,
  DialogHeader,
  EmptyState,
  FormLayout,
  HStack,
  List,
  ListItem,
  Spinner,
  StatusDot,
  Text,
  TextInput,
  VStack,
} from '@astryxdesign/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { z } from 'zod';
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
  validateSearch: z.object({
    accountId: z.string().optional(),
  }),
  beforeLoad: requireWebSession,
  component: OnboardingPage,
});

function OnboardingPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
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
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newResourceName, setNewResourceName] = useState('');
  const [creationNotice, setCreationNotice] = useState<string | null>(null);
  const selectedAccount = rows.find(account => account.accountId === search.accountId);
  const hasRequestedAccount = Boolean(search.accountId);
  const hasUnknownRequestedAccount = hasRequestedAccount && !rows.some(account => account.accountId === search.accountId);
  const configuredAccountCount = rows.filter(isAccountConfigured).length;
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
      if (!name) throw new Error('请填写公众号名称。');
      return await createAccount({ tenantId, name });
    },
    onSuccess: async account => {
      setNewResourceName('');
      setIsCreateOpen(false);
      setCreationNotice(`已创建“${account.name ?? account.accountName ?? '新公众号'}”，请继续填写连接凭据。`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['accounts', tenantId] }),
        queryClient.invalidateQueries({ queryKey: ['current-operator'] }),
        queryClient.invalidateQueries({ queryKey: ['onboarding'] }),
      ]);
      await selectAccount(account.accountId);
    },
  });

  async function selectAccount(accountId: string) {
    await navigate({ to: '/onboarding', search: { accountId } });
  }

  async function showAccountList() {
    await navigate({ to: '/onboarding', search: {}, replace: true });
  }

  function handleCreateOpenChange(isOpen: boolean) {
    setIsCreateOpen(isOpen);
    if (!isOpen) createMutation.reset();
  }

  async function retryResources() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['current-operator'] }),
      queryClient.invalidateQueries({ queryKey: ['accounts', tenantId] }),
    ]);
  }

  function submitNewResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <>
      <PageHeader
        eyebrow="接入设置"
        title="公众号连接"
        description="从列表中选择公众号后，查看状态、更新凭据和管理默认连接。"
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
        {!isResourceLoading && !resourceError && !hasNoTenant ? (
          <section className="onboarding-summary" aria-label="公众号连接概览">
            <Card padding={4}>
              <VStack gap={1}>
                <Text type="supporting">已连接公众号</Text>
                <Text type="large" weight="semibold">{rows.length}</Text>
              </VStack>
            </Card>
            <Card padding={4}>
              <VStack gap={1}>
                <Text type="supporting">授权有效</Text>
                <Text type="large" weight="semibold">{configuredAccountCount}</Text>
              </VStack>
            </Card>
            <Card padding={4}>
              <VStack gap={1}>
                <Text type="supporting">等待配置</Text>
                <Text type="large" weight="semibold">{rows.length - configuredAccountCount}</Text>
              </VStack>
            </Card>
          </section>
        ) : null}

        <SurfaceSection title="公众号列表">
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
              description="创建一个公众号连接后，再提交 AppID/AppSecret 完成授权。"
              actions={<Button label="新增公众号" clickAction={() => setIsCreateOpen(true)} isDisabled={!canWrite} tooltip={!canWrite ? '需要公众号写入权限' : undefined} />}
              isCompact
            />
          ) : (
            <List header="已连接公众号" hasDividers density="compact">
              {rows.map(account => {
                const configured = isAccountConfigured(account);
                const isSelected = selectedAccount?.accountId === account.accountId;
                return (
                  <ListItem
                    key={account.accountId}
                    label={account.name ?? account.accountName ?? '未命名公众号'}
                    description={(
                      <VStack gap={1}>
                        <Text type="supporting"><span className="mono">{account.appId ?? 'AppID 未配置'}</span></Text>
                        <HStack gap={2} vAlign="center">
                          <StatusDot variant={configured ? 'success' : 'warning'} label={configured ? '已连接' : '等待配置'} />
                          <Text type="supporting">{configured ? '已连接' : '等待配置'}{account.isDefault ? ' · 默认公众号' : ''}</Text>
                        </HStack>
                      </VStack>
                    )}
                    endContent={<Text type="supporting">{isSelected ? '正在配置' : '配置'}</Text>}
                    isSelected={isSelected}
                    onClick={() => { void selectAccount(account.accountId); }}
                  />
                );
              })}
            </List>
          )}
          {!resourceError && tenantId && rows.length > 0 ? (
            <div className="onboarding-list-action">
              <Button label="新增公众号" variant="primary" clickAction={() => setIsCreateOpen(true)} isDisabled={!canWrite} tooltip={!canWrite ? '需要公众号写入权限' : undefined} />
            </div>
          ) : null}
        </SurfaceSection>
      </PageStack>

      <Dialog
        className="onboarding-config-drawer"
        isOpen={hasRequestedAccount}
        onOpenChange={isOpen => {
          if (!isOpen) void showAccountList();
        }}
        width="min(620px, 100vw)"
        maxHeight="100dvh"
        position={{ top: 0, right: 0, bottom: 0 }}
        purpose="form"
      >
        <DialogHeader
          title={selectedAccount?.name ?? selectedAccount?.accountName ?? '公众号配置'}
          subtitle="更新连接状态、授权凭据与默认设置。"
          onOpenChange={() => { void showAccountList(); }}
        />
        <div className="onboarding-config-drawer-content">
          {creationNotice ? (
            <Banner status="success" title="公众号已创建" description={creationNotice} isDismissable onDismiss={() => setCreationNotice(null)} />
          ) : null}
          {hasUnknownRequestedAccount ? (
            <Banner
              status="warning"
              title="找不到该公众号"
              description="它可能已被删除，或不属于当前工作空间。"
              endContent={<Button label="关闭" size="sm" clickAction={showAccountList} />}
            />
          ) : selectedAccount && tenantId ? (
            <AccountAuthorizationEditor
              key={selectedAccount.accountId}
              tenantId={tenantId}
              account={selectedAccount}
              canWrite={canWrite}
              onDeleted={() => { void showAccountList(); }}
            />
          ) : null}
        </div>
      </Dialog>

      <Dialog
        isOpen={isCreateOpen}
        onOpenChange={handleCreateOpenChange}
        purpose="form"
      >
        <DialogHeader
          title="新增公众号"
          subtitle="先创建连接名称，再在详情中提交 AppID/AppSecret。"
          onOpenChange={handleCreateOpenChange}
        />
        <form className="onboarding-create-dialog" onSubmit={submitNewResource}>
          <FormLayout>
            <TextInput
              label="公众号名称"
              htmlName="newResourceName"
              value={newResourceName}
              onChange={value => {
                setNewResourceName(value);
                createMutation.reset();
              }}
              description="仅用于当前工作空间内识别，不会同步到微信公众平台。"
              isRequired
              hasAutoFocus
            />
          </FormLayout>
          {createMutation.error ? <p className="form-error" role="alert">{errorMessage(createMutation.error, '创建公众号失败。')}</p> : null}
          <div className="inline-actions">
            <Button label="取消" variant="ghost" clickAction={() => handleCreateOpenChange(false)} />
            <Button label="创建公众号" type="submit" variant="primary" isLoading={createMutation.isPending} isDisabled={!newResourceName.trim()} />
          </div>
        </form>
      </Dialog>
    </>
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
