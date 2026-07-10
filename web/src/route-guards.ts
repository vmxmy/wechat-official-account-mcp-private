import { redirect } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { WebApiError, getCurrentOperator } from './lib/api.js';

export interface WebSessionContext {
  status: 'unknown' | 'authenticated' | 'unauthenticated';
}

export interface RouterContext {
  session: WebSessionContext;
  queryClient: QueryClient;
}

export function initialSessionContext(): WebSessionContext {
  try {
    const value = window.localStorage.getItem('woa:web-session');
    if (value === 'authenticated' || value === 'unauthenticated') {
      return { status: value };
    }
  } catch {
    // localStorage can be unavailable in privacy modes; use server queries later.
  }
  return { status: 'unknown' };
}

export async function requireWebSession({ context, location }: {
  context: RouterContext;
  location: { href: string };
}): Promise<void> {
  try {
    await context.queryClient.fetchQuery({
      queryKey: ['current-operator'],
      queryFn: getCurrentOperator,
      staleTime: 0,
    });
    context.session.status = 'authenticated';
    rememberSessionStatus('authenticated');
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      context.session.status = 'unauthenticated';
      rememberSessionStatus('unauthenticated');
      redirectToLogin(location.href);
    }
    throw error;
  }
}

function redirectToLogin(returnTo: string): never {
  throw redirect({
    href: `/login?returnTo=${encodeURIComponent(returnTo)}`,
  });
}

function isUnauthenticatedError(error: unknown): boolean {
  return error instanceof WebApiError && (error.status === 401 || error.code === 'unauthorized');
}

function rememberSessionStatus(status: WebSessionContext['status']): void {
  try {
    window.localStorage.setItem('woa:web-session', status);
  } catch {
    // localStorage can be unavailable in privacy modes; route guard still relies on /api/v1/me.
  }
}
