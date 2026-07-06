import { Link as RouterLink } from '@tanstack/react-router';
import { forwardRef } from 'react';
import type { AnchorHTMLAttributes } from 'react';

type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href?: string;
};

export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(function AppLink(
  { href = '', children, ...props },
  ref,
) {
  if (isExternalHref(href)) {
    return <a ref={ref} href={href} {...props}>{children}</a>;
  }

  return (
    <RouterLink
      ref={ref}
      to={href || '/'}
      {...props}
    >
      {children}
    </RouterLink>
  );
});

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|tel:|#)/.test(href);
}
