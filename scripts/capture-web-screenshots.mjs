import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const globalNodeModules = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const { chromium } = require(path.join(globalNodeModules, 'playwright'));
const outputDir = path.resolve('docs/screenshots/saas-onboarding');
mkdirSync(outputDir, { recursive: true });

function json(data, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(status < 400
      ? { success: true, data, requestId: 'req_visual_fixture' }
      : { success: false, error: { code: 'fixture_error', message: 'Fixture error' } }),
  };
}

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'light',
  reducedMotion: 'reduce',
  locale: 'zh-CN',
});
const page = await context.newPage();

await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/v1/me') {
    await route.fulfill(json({
      user: { userId: 'op_visual', email: 'owner@example.com', displayName: '公众号运营者' },
      tenants: [{ tenantId: 'ten_visual', name: '内容运营工作空间' }],
      accounts: [
        { accountId: 'acct_visual', tenantId: 'ten_visual', name: '品牌服务号', appId: 'wx1234••••cdef', status: 'active', isDefault: true },
        { accountId: 'acct_pending', tenantId: 'ten_visual', name: '活动订阅号', status: 'unconfigured', isDefault: false },
      ],
      defaultTenantId: 'ten_visual',
      defaultAccountId: 'acct_visual',
      scopes: ['woa:account:read', 'woa:account:write', 'woa:billing:write'],
    }));
    return;
  }
  if (url.pathname === '/api/health') {
    await route.fulfill(json({ ok: true }));
    return;
  }
  if (url.pathname.endsWith('/accounts')) {
    await route.fulfill(json({ accounts: [
      {
        accountId: 'acct_visual',
        tenantId: 'ten_visual',
        name: '品牌服务号',
        appId: 'wx1234••••cdef',
        status: 'active',
        isDefault: true,
        hasAppSecret: true,
        hasWebhookToken: true,
        hasEncodingAESKey: true,
      },
      {
        accountId: 'acct_pending',
        tenantId: 'ten_visual',
        name: '活动订阅号',
        status: 'unconfigured',
        isDefault: false,
        hasAppSecret: false,
      },
    ] }));
    return;
  }
  if (url.pathname.includes('/accounts/') && url.pathname.endsWith('/status')) {
    await route.fulfill(json({
      account: { accountId: 'acct_visual', tenantId: 'ten_visual', name: '品牌服务号', status: 'active', isDefault: true },
      configured: true,
      config: { appId: 'wx1234••••cdef', hasAppSecret: true, hasToken: true, hasEncodingAESKey: true },
    }));
    return;
  }
  if (url.pathname.endsWith('/usage')) {
    await route.fulfill(json({
      tenantId: 'ten_visual',
      entitlement: { tenantId: 'ten_visual', plan: 'plus' },
      metrics: [
        { metric: 'tool_calls_month', limit: 3000, used: 842, remaining: 2158, resetAt: Date.UTC(2026, 7, 1) },
        { metric: 'published_articles_month', limit: 300, used: 46, remaining: 254, resetAt: Date.UTC(2026, 7, 1) },
      ],
    }));
    return;
  }
  if (url.pathname === '/api/v1/sessions') {
    await route.fulfill(json({ sessions: [
      { id: 'sess_web', kind: 'web', clientName: 'WOA Web', createdAt: Date.UTC(2026, 6, 12), expiresAt: Date.UTC(2026, 6, 19), canRevoke: true },
      { id: 'sess_codex', kind: 'oauth', clientName: 'Codex CLI', clientId: 'codex-cli', createdAt: Date.UTC(2026, 6, 10), expiresAt: Date.UTC(2026, 7, 10), canRevoke: true },
    ] }));
    return;
  }
  await route.fulfill(json({}));
});

for (const [name, route] of [
  ['login', '/login'],
  ['onboarding', '/onboarding'],
  ['billing', '/billing'],
  ['mcp', '/mcp?client=kimi'],
  ['security', '/security'],
]) {
  await page.goto(`http://127.0.0.1:4173${route}`, { waitUntil: 'networkidle' });
  await page.screenshot({
    path: path.join(outputDir, `${name}-desktop.png`),
    fullPage: false,
  });
}

await page.setViewportSize({ width: 390, height: 844 });
await page.goto('http://127.0.0.1:4173/mcp?client=kimi', { waitUntil: 'networkidle' });
await page.screenshot({
  path: path.join(outputDir, 'mcp-mobile.png'),
  fullPage: true,
});

await context.close();
await browser.close();
process.stdout.write(`${JSON.stringify({ outputDir, screenshots: 6 })}\n`);
