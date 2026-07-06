import { createFileRoute } from '@tanstack/react-router';
import { Button, StatusDot } from '@astryxdesign/core';
import { PageHeader, PageStack, SurfaceSection } from '../components/Page.js';
import { requireWebSession } from '../route-guards.js';

const sessionRows = [
  { id: 'web-current', client: 'Web session', created: '当前浏览器', expires: '7 天滑动过期', status: '有效' },
  { id: 'cli-example', client: 'woa CLI', created: '授权后显示', expires: 'Refresh token 30 天', status: '可撤销' },
  { id: 'mcp-example', client: 'MCP client', created: '授权后显示', expires: 'Access token 1 小时', status: '可撤销' },
];

export const Route = createFileRoute('/security')({
  beforeLoad: requireWebSession,
  component: SecurityPage,
});

function SecurityPage() {
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
                {sessionRows.map(row => (
                  <tr key={row.id}>
                    <td>{row.client}</td>
                    <td>{row.created}</td>
                    <td>{row.expires}</td>
                    <td><span className="inline-status"><StatusDot variant="neutral" label={row.status} />{row.status}</span></td>
                    <td><Button label="撤销" size="sm" isDisabled={row.id === 'web-current'} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceSection>
      </PageStack>
    </>
  );
}
