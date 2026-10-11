import { expect, test } from '@playwright/test';
import { login, logout } from './helpers';

test('sem sessão redireciona para o login', async ({ page }) => {
  await page.goto('/catalogo');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Iniciar sessão' })).toBeVisible();
});

test('credenciais erradas mostram o erro e não entram', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('comercial@exemplo.pt');
  await page.getByLabel('Palavra-passe').fill('errada-Errada-1');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toContainText('incorretos');
  await expect(page).toHaveURL(/\/login$/);
});

test('comercial entra, vê o catálogo e abre o detalhe de um produto', async ({ page }) => {
  await login(page, 'Comercial');
  await page.getByRole('link', { name: 'Catálogo' }).click();
  await expect(page).toHaveURL(/\/catalogo$/);
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(0);

  const first = rows.first().getByRole('link');
  const name = (await first.textContent())!.trim();
  await first.click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
});

test('só o administrador vê os menus de administração', async ({ page }) => {
  await login(page, 'Comercial');
  await expect(page.getByRole('link', { name: 'Utilizadores' })).toHaveCount(0);
  await page.goto('/utilizadores');
  await expect(page).toHaveURL(/acesso-negado/);
  await page.goto('/propostas');
  await logout(page);

  await login(page, 'Administrador');
  await expect(page.getByRole('link', { name: 'Utilizadores' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Políticas' })).toBeVisible();
});

test('terminar sessão volta ao login', async ({ page }) => {
  await login(page);
  await logout(page);
  await expect(page).toHaveURL(/\/login$/);
});
