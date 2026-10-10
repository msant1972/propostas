import { expect, test } from '@playwright/test';

test('sem sessão redireciona para o login', async ({ page }) => {
  await page.goto('/catalogo');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Iniciar sessão' })).toBeVisible();
});

test('comercial entra, vê o catálogo e abre o detalhe de um produto', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Perfil').selectOption('Comercial');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL(/\/catalogo$/);
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(0);

  const first = rows.first().getByRole('link');
  const name = (await first.textContent())!.trim();
  await first.click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
});

test('terminar sessão volta ao login', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('button', { name: 'Terminar sessão' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
