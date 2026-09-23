// Reject DNS rebinding before serving any endpoint, including static HTML and SSE.
// Do not trust Forwarded/X-Forwarded-Host; this app is loopback-only.
export function allowedLocalHost(host, port) {
  return typeof host === 'string' &&
    (host === '127.0.0.1:' + port || host === 'localhost:' + port);
}
