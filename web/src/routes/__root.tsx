import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { RouterContext } from '../route-guards.js';
import { AppChrome } from '../components/AppChrome.js';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <AppChrome>
      <Outlet />
    </AppChrome>
  );
}
