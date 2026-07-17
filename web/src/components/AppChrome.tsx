import {
  AppShell,
  Avatar,
  Button,
  DropdownMenu,
  HStack,
  MobileNav,
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
import { getCurrentOperator, getHealthStatus, logout } from '../lib/api.js';

const navSections: Array<{
  title: string;
  items: Array<{ href: string; label: string; icon: LucideIcon }>;
}> = [
  {
    title: '工作台',
    items: [{ href: '/app', label: '概览', icon: Gauge }],
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
  const isLoginRoute = location.pathname === '/login';
  const isPublicLandingRoute = location.pathname === '/';
  const isPublicDocumentRoute = location.pathname.startsWith('/legal/');
  const isPublicRoute = isPublicLandingRoute || isPublicDocumentRoute;
  const current = useQuery({
    queryKey: ['current-operator'],
    queryFn: getCurrentOperator,
    retry: false,
    enabled: !isLoginRoute && !isPublicRoute,
  });
  const health = useQuery({
    queryKey: ['service-health'],
    queryFn: getHealthStatus,
    retry: false,
    refetchInterval: 30_000,
    enabled: !isLoginRoute && !isPublicRoute,
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

  if (isLoginRoute) {
    return (
      <AppShell contentPadding={0} height="auto" mobileNav={false} variant="wash">
        {children}
      </AppShell>
    );
  }

  if (isPublicLandingRoute) {
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
            label="公开页面导航"
          />
        }
        contentPadding={0}
        height="auto"
        mobileNav={false}
        variant="wash"
      >
        <div className="app-layout-content app-layout-content--landing">
          <div className="app-page-frame app-page-frame--landing">{children}</div>
        </div>
      </AppShell>
    );
  }

  if (isPublicDocumentRoute) {
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
            endContent={<Button label="登录" href="/login" size="sm" />}
            label="公共页面导航"
          />
        }
        contentPadding={0}
        height="auto"
        mobileNav={false}
        variant="wash"
      >
        <div className="app-layout-content app-layout-content--public">
          <div className="app-page-frame app-page-frame--document">{children}</div>
        </div>
      </AppShell>
    );
  }

  const healthLabel = health.isLoading
    ? '正在检查服务'
    : health.error
      ? '服务状态异常'
      : '服务正常';
  const healthVariant = health.isLoading ? 'neutral' : health.error ? 'error' : 'success';
  const navigationSections = renderNavigationSections(location.pathname);

  return (
    <AppShell
      topNav={
        <TopNav
          className="app-top-nav"
          heading={
            <TopNavHeading
              logo={<span className="app-brand-mark" aria-hidden="true">W</span>}
              heading="WOA"
              headingHref="/app"
              subheading="微信公众号 MCP"
            />
          }
          endContent={
            <HStack gap={3} vAlign="center">
              <HStack className="app-service-status" gap={2} as="span" vAlign="center">
                <StatusDot variant={healthVariant} label={healthLabel} />
                <Text type="supporting" weight="medium">{healthLabel}</Text>
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
          {navigationSections}
        </SideNav>
      }
      mobileNav={{
        hasToggle: true,
        breakpoint: 'md',
        content: (
          <MobileNav header="主导航">
            {navigationSections}
            <div className="app-mobile-account">
              <HStack gap={2} vAlign="center">
                <StatusDot variant={healthVariant} label={healthLabel} />
                <Text type="supporting">{healthLabel}</Text>
              </HStack>
              {operator ? <Text type="supporting">{accountLabel}</Text> : null}
              <Button label="退出登录" clickAction={() => { void handleLogout(); }} className="auth-full-width" />
            </div>
          </MobileNav>
        ),
      }}
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

function renderNavigationSections(pathname: string) {
  return navSections.map(section => (
    <SideNavSection key={section.title} title={section.title}>
      {section.items.map(item => {
        const Icon = item.icon;
        return (
          <SideNavItem
            key={item.href}
            label={item.label}
            href={item.href}
            icon={<Icon aria-hidden="true" size={18} strokeWidth={1.8} />}
            isSelected={isCurrentRoute(pathname, item.href)}
          />
        );
      })}
    </SideNavSection>
  ));
}

function isCurrentRoute(pathname: string, href: string): boolean {
  if (href === '/') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
