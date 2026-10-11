import type { Page } from '@playwright/test';
import { DEMO_PASSWORD, DEMO_USERS, type Role } from '@cpq/shared/roles';

/** Entra com o utilizador de demonstração do papel (criado pelo seed). */
export async function login(page: Page, role: Role = 'Comercial'): Promise<void> {
  const u = DEMO_USERS.find((x) => x.role === role)!;
  await page.goto('/login');
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Palavra-passe').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Terminar sessão' }).click();
}

export const sessionToken = (page: Page) =>
  page.evaluate(() => (JSON.parse(sessionStorage.getItem('cpq.session')!) as { accessToken: string }).accessToken);
