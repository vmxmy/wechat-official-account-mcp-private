import {
  AppShell,
  Avatar,
  DropdownMenu,
  HStack,
  SideNav,
  SideNavItem,
  SideNavSection,
  StatusDot,
  Text,
  TopNav,
  TopNavHeading,
} from '@astryxdesign/core';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cable, Gauge, RadioTower, ShieldCheck, WalletCards } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { getCurrentOperator, logout } from '../lib/api.js';

const navSections: Array<{
  title: string;
  items: Array<{ href: string; label: string; icon: LucideIcon }>;
}> = [
  {
    title: '工作台',
    items: [{ href: '/', label: '概览', icon: Gauge }],
  },
  {
    title: '接入',
    items: [
      { href: '/onboarding', label: '公众号资源', icon: RadioTower },
      { href: '/mcp', label: 'MCP 接入', icon: Cable },
    ],
  },
  {
    title: '账户',
    items: [
      { href: '/billing', label: '用量与套餐', icon: WalletCards },
      { href: '/security', label: '安全与授权', icon: ShieldCheck },
    ],
  },
];

export function AppChrome({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const isPublicRoute = location.pathname === '/login';
  const current = useQuery({
    queryKey: ['current-operator'],
    queryFn: getCurrentOperator,
    retry: false,
    enabled: !isPublicRoute,
  });
  const operator = current.data?.operator;
  const accountLabel = operator?.displayName || operator?.email || '账户';

  async function handleLogout() {
    setLogoutError(null);
    try {
      await logout();
    } catch {
      setLogoutError('退出失败，请重试');
      return;
    }

    queryClient.clear();
    try {
      window.localStorage.setItem('woa:web-session', 'unauthenticated');
    } catch {
      // localStorage can be unavailable in privacy modes.
    }
    try {
      await navigate({ to: '/login' });
    } catch {
      window.location.assign('/login');
    }
  }

  if (isPublicRoute) {
    return (
      <AppShell contentPadding={0} height="auto" mobileNav={false} variant="wash">
        {children}
      </AppShell>
    );
  }

  return (
    <AppShell
      topNav={
        <TopNav
          className="app-top-nav"
          heading={
            <TopNavHeading
              logo={<span className="app-brand-mark" aria-hidden="true">W</span>}
              heading="WOA"
              headingHref="/"
              subheading="微信公众号 MCP"
            />
          }
          endContent={
            <HStack gap={3} vAlign="center">
              <HStack className="app-service-status" gap={2} as="span" vAlign="center">
                <StatusDot variant="success" label="WOA 服务运行正常" />
                <Text type="supporting" weight="medium">服务正常</Text>
              </HStack>
              {operator ? (
                <>
                {logoutError ? (
                  <HStack gap={2} as="span" vAlign="center" role="alert">
                    <StatusDot variant="error" label={logoutError} />
                    <Text type="supporting">{logoutError}</Text>
                  </HStack>
                ) : null}
                <DropdownMenu
                  button={{
                    label: accountLabel,
                    icon: <Avatar name={accountLabel} size="xsmall" />,
                    variant: 'ghost',
                  }}
                  items={[
                    { label: '退出登录', onClick: () => { void handleLogout(); } },
                  ]}
                  menuWidth={220}
                />
                </>
              ) : null}
            </HStack>
          }
          label="主导航"
        />
      }
      sideNav={
        <SideNav className="app-side-nav" collapsible={{ buttonLabel: '收起导航' }}>
          {navSections.map(section => (
            <SideNavSection key={section.title} title={section.title}>
              {section.items.map(item => {
                const Icon = item.icon;
                return (
                  <SideNavItem
                    key={item.href}
                    label={item.label}
                    href={item.href}
                    icon={<Icon aria-hidden="true" size={18} strokeWidth={1.8} />}
                    isSelected={isCurrentRoute(location.pathname, item.href)}
                  />
                );
              })}
            </SideNavSection>
          ))}
        </SideNav>
      }
      contentPadding={0}
      height="fill"
      variant="wash"
    >
      <div className="app-layout-content">
        <div className="app-page-frame">{children}</div>
      </div>
    </AppShell>
  );
}

function isCurrentRoute(pathname: string, href: string): boolean {
  if (href === '/') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
