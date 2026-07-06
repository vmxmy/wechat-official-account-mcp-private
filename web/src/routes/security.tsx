import { createFileRoute } from '@tanstack/react-router';
import { Button, StatusDot } from '@astryxdesign/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader, PageStack, SurfaceSection } from '../components/Page.js';
import { getSecuritySessions, revokeSecuritySession } from '../lib/api.js';
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

  return (
    <>
      <PageHeader
        title="会话与授权客户端"
        description="撤销 Web session、CLI refresh token 或 MCP client 授权后，对应入口需要重新登录。"
      />
      <PageStack>
        <SurfaceSection title="授权列表">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>客户端</th>
                  <th>创建时间</th>
                  <th>过期策略</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>暂无可显示的授权会话。登录后会显示 Web、CLI 或 MCP 授权记录。</td>
                  </tr>
                ) : rows.map(row => (
                  <tr key={row.id}>
                    <td>{row.clientName ?? row.clientId ?? row.kind ?? '未知客户端'}</td>
                    <td>{formatTime(row.createdAt)}</td>
                    <td>{formatTime(row.expiresAt)}</td>
                    <td><span className="inline-status"><StatusDot variant={row.revokedAt ? 'neutral' : 'success'} label={row.revokedAt ? '已撤销' : '有效'} />{row.revokedAt ? '已撤销' : '有效'}</span></td>
                    <td>
                      <Button
                        label="撤销"
                        size="sm"
                        isLoading={revoke.isPending}
                        isDisabled={!row.canRevoke}
                        clickAction={() => revoke.mutate(row.id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sessions.error ? (
            <p className="section-copy" style={{ marginTop: 14 }}>
              {sessions.error instanceof Error ? sessions.error.message : '读取授权会话失败。'}
            </p>
          ) : null}
          {revoke.error ? (
            <p className="section-copy" style={{ marginTop: 14 }}>
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
