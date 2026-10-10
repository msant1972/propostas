export const env = {
  authMode: (import.meta.env['VITE_AUTH_MODE'] ?? 'dev') as 'dev' | 'entra',
  apiBase: (import.meta.env['VITE_API_BASE'] ?? '') as string,
  entraClientId: (import.meta.env['VITE_ENTRA_CLIENT_ID'] ?? '') as string,
  entraTenantId: (import.meta.env['VITE_ENTRA_TENANT_ID'] ?? '') as string,
  entraApiScope: (import.meta.env['VITE_ENTRA_API_SCOPE'] ?? '') as string,
  otelEndpoint: (import.meta.env['VITE_OTEL_ENDPOINT'] ?? '') as string,
};
