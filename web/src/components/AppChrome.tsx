import { AppShell, TopNav, TopNavHeading, TopNavItem } from '@astryxdesign/core';
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
    <AppShell
      topNav={
        <TopNav
          heading={<TopNavHeading heading="WOA" subheading="微信公众号 MCP SaaS" />}
          label="主导航"
        >
          {navItems.map(item => (
            <TopNavItem key={item.href} label={item.label} href={item.href} />
          ))}
        </TopNav>
      }
      contentPadding={4}
      variant="elevated"
    >
      {children}
    </AppShell>
  );
}
