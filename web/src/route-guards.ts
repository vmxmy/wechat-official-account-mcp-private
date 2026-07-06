import { redirect } from '@tanstack/react-router';

export interface WebSessionContext {
  status: 'unknown' | 'authenticated' | 'unauthenticated';
}

export interface RouterContext {
  session: WebSessionContext;
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

export function requireWebSession({ context, location }: {
  context: RouterContext;
  location: { href: string };
}): void {
  if (context.session.status === 'unauthenticated') {
    throw redirect({
      href: `/login?returnTo=${encodeURIComponent(location.href)}`,
    });
  }
}
