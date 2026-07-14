import { createFileRoute } from '@tanstack/react-router';
import {
  AlertDialog,
  Button,
  EmptyState,
  FormLayout,
  HStack,
  List,
  ListItem,
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
    },
  });

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
            clickAction={() => setSelectedAccountId(account.accountId)}
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
          title="连接微信公众号"
          description="选择要管理的公众号，验证或更新 AppID/AppSecret，并查看当前连接状态。"
        />
        <PageStack>
          <SurfaceSection title="公众号资源">
            {!tenantId || current.isLoading || accounts.isLoading ? (
              <Text type="supporting" as="p">正在读取当前工作空间与公众号资源…</Text>
            ) : rows.length === 0 ? (
              <EmptyState
                title="当前工作空间没有公众号资源"
                description="创建资源后再提交 AppID/AppSecret；凭据验证失败时不会保存。"
                actions={<Button label="创建资源" clickAction={() => createMutation.mutate()} isDisabled={!canWrite} />}
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
                                  <Button label="管理此公众号" size="sm" clickAction={() => setSelectedAccountId(account.accountId)} />
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
            {current.error || accounts.error ? (
              <p className="form-error" role="alert">
                {errorMessage(current.error ?? accounts.error, '读取公众号资源失败，请刷新后重试。')}
              </p>
            ) : null}
          </SurfaceSection>

          {tenantId && selectedAccount ? (
            <AccountAuthorizationEditor
              key={selectedAccount.accountId}
              tenantId={tenantId}
              account={selectedAccount}
              canWrite={canWrite}
              onDeleted={() => setSelectedAccountId(undefined)}
            />
          ) : null}

          <SurfaceSection title="新增公众号资源" tone="quiet">
            <form onSubmit={submitNewResource}>
              <FormLayout>
                <TextInput
                  label="资源名称（必填）"
                  htmlName="newResourceName"
                  value={newResourceName}
                  onChange={setNewResourceName}
                  description="新资源创建后处于未配置状态；可用数量受当前套餐限制。"
                  aria-required="true"
                />
              </FormLayout>
              <div className="inline-actions">
                <Button
                  label="创建未配置资源"
                  type="submit"
                  isLoading={createMutation.isPending}
                  isDisabled={!tenantId || !canWrite || !newResourceName.trim()}
                />
              </div>
            </form>
            {createMutation.error ? (
              <p className="form-error" role="alert">{errorMessage(createMutation.error, '创建公众号资源失败。')}</p>
            ) : null}
          </SurfaceSection>
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
  const configured = status.data?.configured ?? isAccountConfigured(account);
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
      <SurfaceSection title="当前连接状态" tone={configured ? 'accent' : 'default'}>
        <DefinitionList columns="multi" items={[
          { label: '资源名称', value: account.name ?? account.accountName ?? '未命名资源' },
          { label: '资源 ID', value: <span className="mono">{account.accountId}</span> },
          {
            label: '授权状态',
            value: (
              <HStack gap={2} as="span" vAlign="center">
                <StatusDot variant={configured ? 'success' : status.error ? 'error' : 'warning'} label={configured ? '授权有效' : status.error ? '状态读取失败' : '未配置'} />
                <Text>{configured ? '已验证并启用' : status.error ? '状态暂不可用' : '等待 AppID/AppSecret'}</Text>
              </HStack>
            ),
          },
          { label: 'AppID', value: currentAppId ? <span className="mono">{currentAppId}</span> : '未配置' },
          { label: 'AppSecret', value: hasAppSecret ? '已加密保存' : '未配置' },
          { label: 'Webhook Token', value: hasWebhookToken ? '已加密保存' : '未配置' },
          { label: 'EncodingAESKey', value: hasEncodingAESKey ? '已加密保存' : '未配置' },
          { label: '默认资源', value: account.isDefault ? '是' : '否' },
          { label: '最后更新', value: formatTime(account.updatedAt) },
        ]} />
        {status.error ? (
          <p className="form-error" role="alert">{errorMessage(status.error, '读取当前授权状态失败。')}</p>
        ) : null}
      </SurfaceSection>

      <SurfaceSection title="资源名称与默认设置">
        <form onSubmit={submitResourceSettings}>
          <FormLayout>
            <TextInput
              label="资源名称（必填）"
              htmlName="resourceName"
              value={resourceName}
              onChange={setResourceName}
              description="名称仅用于当前工作空间内识别，不会同步到微信公众平台。"
              aria-required="true"
            />
          </FormLayout>
          <div className="inline-actions">
            <Button
              label="保存名称"
              type="submit"
              isLoading={renameMutation.isPending}
              isDisabled={!canWrite || !resourceName.trim()}
            />
            <Button
              label={account.isDefault ? '当前默认资源' : '设为默认资源'}
              variant="ghost"
              isLoading={defaultMutation.isPending}
              isDisabled={!canWrite || account.isDefault}
              clickAction={() => defaultMutation.mutate()}
            />
          </div>
        </form>
        {renameMutation.isSuccess ? <p className="auth-success" role="status">资源名称已保存。</p> : null}
        {renameMutation.error || defaultMutation.error ? (
          <p className="form-error" role="alert">
            {errorMessage(renameMutation.error ?? defaultMutation.error, '更新公众号资源失败。')}
          </p>
        ) : null}
      </SurfaceSection>

      <SurfaceSection title={configured ? '更新公众号凭据' : '连接公众号凭据'}>
        <form className="credential-form" onSubmit={submitCredentials}>
          <FormLayout>
            <TextInput
              label="AppID（必填）"
              htmlName="appId"
              value={appId}
              onChange={setAppId}
              placeholder="wx..."
              aria-required="true"
            />
            <TextInput
              label="AppSecret（必填）"
              htmlName="appSecret"
              type="password"
              value={appSecret}
              onChange={setAppSecret}
              description={configured ? '系统不会显示现有值；更新连接时必须重新输入。' : '只发送到受保护的服务端，不保存在浏览器。'}
              aria-required="true"
            />
            <TextInput
              label="Webhook Token（可选）"
              htmlName="token"
              value={webhookToken}
              onChange={setWebhookToken}
              description={hasWebhookToken ? '已配置；留空会保留现有值，填写后替换。' : '可选；启用收件箱和入站消息前配置。'}
            />
            <TextInput
              label="EncodingAESKey（可选）"
              htmlName="encodingAESKey"
              value={encodingAESKey}
              onChange={setEncodingAESKey}
              description={hasEncodingAESKey ? '已配置；留空会保留现有值，填写后替换。' : '可选；微信安全模式回调需要。'}
            />
          </FormLayout>
          <div className="inline-actions">
            <Button
              label={configured ? '验证并更新授权' : '验证并保存授权'}
              type="submit"
              variant="primary"
              isLoading={configureMutation.isPending}
              isDisabled={!canWrite || !appId.trim() || !appSecret}
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

      <SurfaceSection title="删除资源与授权信息" tone="quiet">
        <VStack gap={3}>
          <Text type="supporting" as="p" textWrap="pretty">
            删除后资源会停用，AppSecret、Webhook Token、EncodingAESKey 和缓存访问令牌会被清除；历史审计记录保留。
          </Text>
          <div className="inline-actions">
            <Button
              label="删除当前公众号资源"
              variant="destructive"
              isDisabled={!canWrite}
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
        description="该操作会停用资源并永久清除相关密钥与缓存访问令牌。历史审计记录不会删除。"
        cancelLabel="取消"
        actionLabel="删除资源与密钥"
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
