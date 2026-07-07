#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const widgetName = process.env.TURNSTILE_WIDGET_NAME || 'WOA production login';
const widgetDomain = process.env.TURNSTILE_WIDGET_DOMAIN || 'woa.ziikoo.app';

if (!accountId || !apiToken) {
  console.error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.');
  process.exit(1);
}

const apiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets`;

async function cloudflare(path = '', init = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiToken}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const detail = Array.isArray(data.errors) && data.errors.length
      ? data.errors.map(error => `${error.code ?? 'error'}: ${error.message ?? 'unknown'}`).join('; ')
      : `HTTP ${response.status}`;
    throw new Error(`Cloudflare Turnstile API failed: ${detail}`);
  }
  return data.result;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.result)) return value.result;
  return [];
}

async function findExistingWidget() {
  const result = await cloudflare();
  return asArray(result).find(widget => {
    const domains = Array.isArray(widget.domains) ? widget.domains : [];
    return widget.name === widgetName || domains.includes(widgetDomain);
  });
}

async function getWidgetWithSecret(sitekey) {
  return await cloudflare(`/${encodeURIComponent(sitekey)}`);
}

function requireWidgetSecret(widget) {
  if (!widget?.sitekey) throw new Error('Turnstile widget response did not include sitekey.');
  if (!widget?.secret) throw new Error('Turnstile widget response did not include secret.');
  return { sitekey: widget.sitekey, secret: widget.secret };
}

function putWorkerSecret(name, value) {
  const result = spawnSync('npx', ['wrangler', 'secret', 'put', name], {
    input: value,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) {
    console.error(output.replace(value, '<redacted>'));
    throw new Error(`wrangler secret put ${name} failed with exit ${result.status}`);
  }
  for (const line of output.split('\n')) {
    if (/Success|Uploaded secret|Creating the secret|Updating the secret/.test(line)) {
      console.log(line);
    }
  }
}

const existing = await findExistingWidget();
const widget = existing?.sitekey
  ? await getWidgetWithSecret(existing.sitekey)
  : await cloudflare('', {
      method: 'POST',
      body: JSON.stringify({
        name: widgetName,
        domains: [widgetDomain],
        mode: 'managed',
      }),
    });

const { sitekey, secret } = requireWidgetSecret(widget);
putWorkerSecret('TURNSTILE_SECRET_KEY', secret);
console.log(`TURNSTILE_SITE_KEY=${sitekey}`);
