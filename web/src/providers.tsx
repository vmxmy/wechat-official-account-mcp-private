import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LinkProvider, Theme } from '@astryxdesign/core';
import type { ReactNode } from 'react';
import { ziikooWoaTheme } from './ziikoo-woa.js';
import { AppLink } from './components/AppLink.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <Theme theme={ziikooWoaTheme} mode="system">
      <LinkProvider component={AppLink}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </LinkProvider>
    </Theme>
  );
}
