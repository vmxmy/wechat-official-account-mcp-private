import { Link, Text } from '@astryxdesign/core';
import type { ReactNode } from 'react';

const navItems = [
  { href: '/login', label: '登录' },
  { href: '/onboarding', label: '配置公众号' },
  { href: '/billing', label: '订阅' },
  { href: '/mcp', label: 'MCP 配置' },
  { href: '/security', label: '安全' },
];

export function AppChrome({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-brand">
          <strong>WOA</strong>
          <Text type="supporting" as="span">微信公众号 MCP SaaS</Text>
        </div>
        <nav className="app-nav" aria-label="主导航">
          {navItems.map(item => (
            <Link key={item.href} href={item.href} isStandalone>{item.label}</Link>
          ))}
        </nav>
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
