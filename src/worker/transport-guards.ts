export function isRemovedMcpTransportPath(pathname: string): boolean {
  return pathname === '/sse' ||
    pathname.startsWith('/sse/') ||
    pathname === '/messages' ||
    pathname.startsWith('/messages/');
}

export function removedMcpTransportResponseForRequest(request: Request): Response | null {
  const url = new URL(request.url);
  if (!isRemovedMcpTransportPath(url.pathname)) return null;
  return new Response('Not Found', { status: 404 });
}
