import { createFileRoute } from '@tanstack/react-router';
import { Button, EmptyState, HStack, StatusDot, Table, type TableColumn } from '@astryxdesign/core';
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
          label="撤销"
          size="sm"
          isLoading={revoke.isPending}
          isDisabled={!row.canRevoke}
          clickAction={() => revoke.mutate(row.id)}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="会话与授权客户端"
        description="撤销 Web session、CLI refresh token 或 MCP client 授权后，对应入口需要重新登录。"
      />
      <PageStack>
        <SurfaceSection title="授权列表">
          {rows.length === 0 ? (
            <EmptyState
              title="暂无可显示的授权会话"
              description="登录后会显示 Web、CLI 或 MCP 授权记录。"
              isCompact
            />
          ) : (
            <Table data={rows} idKey="id" columns={columns} dividers="rows" hasHover />
          )}
          {sessions.error ? (
            <p className="section-copy">
              {sessions.error instanceof Error ? sessions.error.message : '读取授权会话失败。'}
            </p>
          ) : null}
          {revoke.error ? (
            <p className="section-copy">
              {revoke.error instanceof Error ? revoke.error.message : '撤销失败，请刷新后重试。'}
            </p>
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
