import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { routeTree } from '../dist/web/src/routeTree.gen.js';
import { WebApiError } from '../dist/web/src/lib/api.js';
import { requireWebSession } from '../dist/web/src/route-guards.js';

const originalFetch = globalThis.fetch;

function apiResponse(data, status = 200) {
  return new Response(JSON.stringify(status < 400
    ? { success: true, data, requestId: 'req_web_ssr' }
    : { success: false, error: { code: 'unauthorized', message: 'Unauthorized' } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetch(authenticated = true) {
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === '/api/v1/me') {
      if (!authenticated) return apiResponse(null, 401);
      return apiResponse({
        user: { userId: 'op_web_ssr', email: 'owner@example.com', displayName: '运营者' },
        tenants: [{ tenantId: 'ten_web_ssr', name: '测试工作空间' }],
        accounts: [{ accountId: 'acct_web_ssr', tenantId: 'ten_web_ssr', name: '测试公众号', isDefault: true }],
        defaultTenantId: 'ten_web_ssr',
        defaultAccountId: 'acct_web_ssr',
        scopes: ['woa:account:read', 'woa:account:write'],
      });
    }
    if (url.includes('/accounts')) {
      return apiResponse({
        accounts: [{
          accountId: 'acct_web_ssr',
          tenantId: 'ten_web_ssr',
          name: '测试公众号',
          status: 'active',
          isDefault: true,
          hasAppSecret: true,
        }],
      });
    }
    if (url.includes('/usage')) {
      return apiResponse({
        tenantId: 'ten_web_ssr',
        entitlement: { tenantId: 'ten_web_ssr', plan: 'plus' },
        metrics: [{ metric: 'tool_calls_month', limit: 3000, used: 12, remaining: 2988, resetAt: Date.UTC(2026, 7, 1) }],
      });
    }
    if (url === '/api/v1/sessions') {
      return apiResponse({ sessions: [] });
    }
    if (url === '/api/health') {
      return apiResponse({ ok: true });
    }
    return apiResponse({});
  };
}

async function renderPath(path, authenticated = true) {
  installFetch(authenticated);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: {
      session: { status: 'unknown' },
      queryClient,
    },
  });
  await router.load();
  const html = renderToStaticMarkup(createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(RouterProvider, { router }),
  ));
  return { html, location: router.state.location.href };
}

async function unauthenticatedRedirectHref() {
  try {
    await requireWebSession({
      context: {
        session: { status: 'unknown' },
        queryClient: {
          async fetchQuery() {
            throw new WebApiError('Unauthorized', 401, 'unauthorized');
          },
        },
      },
      location: { href: '/security?tab=clients' },
    });
    return null;
  } catch (error) {
    return error?.options?.href ?? null;
  }
}

try {
  const cases = {
    login: await renderPath('/login?returnTo=%2Fonboarding'),
    onboarding: await renderPath('/onboarding'),
    billing: await renderPath('/billing'),
    security: await renderPath('/security'),
    unauthenticatedHref: await unauthenticatedRedirectHref(),
  };
  const result = {
    login: cases.login.html.includes('欢迎回来'),
    onboarding: cases.onboarding.html.includes('公众号连接'),
    billing: cases.billing.html.includes('订阅与用量'),
    security: cases.security.html.includes('会话与授权客户端'),
    unauthenticatedRedirect:
      cases.unauthenticatedHref === '/login?returnTo=%2Fsecurity%3Ftab%3Dclients',
  };
  const passed = Object.values(result).every(Boolean);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!passed) process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
}
