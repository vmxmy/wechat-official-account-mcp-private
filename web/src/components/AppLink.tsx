import { Link as RouterLink } from '@tanstack/react-router';
import { forwardRef } from 'react';
import type { AnchorHTMLAttributes } from 'react';

type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href?: string;
  to?: string;
};

export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(function AppLink(
  { href = '', children, ...props },
  ref,
) {
  const linkProps = { ...props };
  delete linkProps.to;

  if (isDocumentNavigationHref(href)) {
    return <a ref={ref} href={href} {...linkProps}>{children}</a>;
  }

  return (
    <RouterLink
      ref={ref}
      to={href || '/'}
      {...linkProps}
    >
      {children}
    </RouterLink>
  );
});

function isDocumentNavigationHref(href: string): boolean {
  return /^(https?:|mailto:|tel:|#)/.test(href) ||
    href.startsWith('/auth/') ||
    href.startsWith('/api/') ||
    href.startsWith('/oauth/') ||
    href === '/authorize' ||
    href.startsWith('/authorize?');
}
