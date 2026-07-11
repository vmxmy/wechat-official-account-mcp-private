import { QueryClientProvider } from '@tanstack/react-query';
import { LinkProvider, Theme } from '@astryxdesign/core';
import { stoneTheme } from '@astryxdesign/theme-stone/built';
import type { ReactNode } from 'react';
import { AppLink } from './components/AppLink.js';
import { queryClient } from './query-client.js';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <Theme theme={stoneTheme} mode="system">
      <LinkProvider component={AppLink}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </LinkProvider>
    </Theme>
  );
}
