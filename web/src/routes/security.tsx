import { createFileRoute } from '@tanstack/react-router';
import { Banner, Button, EmptyState, HStack, List, ListItem, Spinner, StatusDot, Table, Text, type TableColumn } from '@astryxdesign/core';
import { proportional } from '@astryxdesign/core/Table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, PageStack, SurfaceSection } from '../components/Page.js';
import { getSecuritySessions, revokeSecuritySession, securitySessionSchema } from '../lib/api.js';
import type { z } from 'zod';
import { requireWebSession } from '../route-guards.js';

export const Route = createFileRoute('/security')({
  beforeLoad: requireWebSession,
  component: SecurityPage,
});

function SecurityPage() {
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ['security-sessions'],
    queryFn: getSecuritySessions,
  });
  const revoke = useMutation({
    mutationFn: revokeSecuritySession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['security-sessions'] });
    },
  });
  const rows = sessions.data?.sessions ?? [];

  const columns: TableColumn<z.infer<typeof securitySessionSchema>>[] = [
    {
      key: 'client',
      header: '客户端',
      width: proportional(1),
      renderCell: row => row.clientName ?? row.clientId ?? row.kind ?? '未知客户端',
    },
    {
      key: 'createdAt',
      header: '创建时间',
      renderCell: row => formatTime(row.createdAt),
    },
    {
      key: 'expiresAt',
      header: '过期策略',
      renderCell: row => formatTime(row.expiresAt),
    },
    {
      key: 'status',
      header: '状态',
      renderCell: row => (
        <HStack gap={2}>
          <StatusDot variant={row.revokedAt ? 'neutral' : 'success'} label={row.revokedAt ? '已撤销' : '有效'} />
          {row.revokedAt ? '已撤销' : '有效'}
        </HStack>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      renderCell: row => (
        <Button
          label={row.revokedAt ? '已撤销' : '撤销授权'}
          size="sm"
          isLoading={revoke.isPending && revoke.variables === row.id}
          isDisabled={!row.canRevoke || revoke.isPending}
          clickAction={() => revoke.mutate(row.id)}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="访问控制"
        title="会话与授权客户端"
        description="查看 Web、命令行和 MCP 客户端的登录授权；撤销后，对应客户端需要重新登录。"
      />
      <PageStack>
        <SurfaceSection title="授权列表">
          {sessions.isLoading ? (
            <Spinner label="正在读取授权会话…" />
          ) : sessions.error ? (
            <Banner
              status="error"
              title="授权会话读取失败"
              description={sessions.error instanceof Error ? sessions.error.message : '请稍后重试。'}
              endContent={<Button label="重新读取" size="sm" clickAction={() => { void sessions.refetch(); }} />}
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="暂无可显示的授权会话"
              description="新的 Web、CLI 或 MCP 客户端完成登录后会显示在这里。"
              isCompact
            />
          ) : (
            <>
              <div className="responsive-table-desktop">
                <Table data={rows} idKey="id" columns={columns} dividers="rows" hasHover />
              </div>
              <div className="responsive-list-mobile">
                <List header="授权客户端" hasDividers density="compact">
                  {rows.map(row => (
                    <ListItem
                      key={row.id}
                      label={row.clientName ?? row.clientId ?? row.kind ?? '未知客户端'}
                      description={(
                        <div className="responsive-row-content">
                          <Text type="supporting">
                            {row.revokedAt ? '已撤销' : '有效'} · 创建于 {formatTime(row.createdAt)} · 到期 {formatTime(row.expiresAt)}
                          </Text>
                          <div className="responsive-row-action">
                            <Button
                              label={row.revokedAt ? '已撤销' : '撤销授权'}
                              size="sm"
                              isLoading={revoke.isPending && revoke.variables === row.id}
                              isDisabled={!row.canRevoke || revoke.isPending}
                              clickAction={() => revoke.mutate(row.id)}
                            />
                          </div>
                        </div>
                      )}
                    />
                  ))}
                </List>
              </div>
            </>
          )}
          {revoke.error ? (
            <Banner
              status="error"
              title="撤销授权失败"
              description={revoke.error instanceof Error ? revoke.error.message : '请刷新后重试。'}
            />
          ) : revoke.isSuccess ? (
            <Banner
              status="success"
              title="授权已撤销"
              description="对应客户端再次访问时需要重新登录。"
              isDismissable
              onDismiss={() => revoke.reset()}
            />
          ) : null}
        </SurfaceSection>
      </PageStack>
    </>
  );
}

function formatTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = typeof value === 'number'
    ? new Date(value < 1_000_000_000_000 ? value * 1000 : value)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}
