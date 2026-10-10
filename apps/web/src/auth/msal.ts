import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import { env } from '../lib/env';

let instance: PublicClientApplication | null = null;

export async function getMsal(): Promise<PublicClientApplication> {
  if (!instance) {
    instance = new PublicClientApplication({
      auth: {
        clientId: env.entraClientId,
        authority: `https://login.microsoftonline.com/${env.entraTenantId}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'sessionStorage' },
    });
    await instance.initialize();
  }
  return instance;
}

const scopes = () => [env.entraApiScope];

/** Token de acesso à API, com renovação silenciosa; cai para redirecionamento se for preciso consentimento. */
export async function acquireEntraToken(): Promise<{ token: string; account: AccountInfo } | null> {
  const msal = await getMsal();
  const result = await msal.handleRedirectPromise();
  const account = result?.account ?? msal.getActiveAccount() ?? msal.getAllAccounts()[0];
  if (!account) return null;
  msal.setActiveAccount(account);
  try {
    const r = await msal.acquireTokenSilent({ scopes: scopes(), account });
    return { token: r.accessToken, account };
  } catch {
    await msal.acquireTokenRedirect({ scopes: scopes(), account });
    return null;
  }
}

export async function entraLogin(): Promise<void> {
  const msal = await getMsal();
  await msal.loginRedirect({ scopes: scopes() });
}

export async function entraLogout(): Promise<void> {
  const msal = await getMsal();
  await msal.logoutRedirect();
}
