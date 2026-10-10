import { expect, test } from '@playwright/test';

test('comercial cria uma proposta, cota, vê os totais e bloqueia a versão', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Perfil').selectOption('Comercial');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await page.getByRole('link', { name: 'Propostas' }).click();
  await page.getByRole('button', { name: 'Nova proposta' }).click();
  const title = `Proposta e2e ${Date.now()}`;
  await page.getByLabel('Título').fill(title);
  await page.getByLabel('Cliente').selectOption({ label: 'Cliente Exemplo, Lda.' });
  await page.getByRole('button', { name: 'Criar' }).click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByLabel('Produto').selectOption({ label: 'IMP-BAS — Implementação Base' });
  await page.getByRole('button', { name: 'Adicionar linha' }).click();
  await page.getByLabel('Quantidade 1').fill('10');

  // IMP-BAS: custo 45 → preço 90; 10 h = 900,00; IVA 23 % = 207,00; total 1107,00
  const totals = page.getByTestId('totals');
  await expect(totals).toContainText('900.00 EUR');
  await expect(totals).toContainText('207.00 EUR');
  await expect(totals).toContainText('1107.00 EUR');
  await expect(totals).not.toContainText('Margem'); // o comercial não vê margens

  await page.getByRole('button', { name: 'Guardar rascunho' }).click();
  await expect(page.getByRole('status')).toContainText('Rascunho guardado');

  await page.getByRole('button', { name: 'Bloquear versão' }).click();
  await expect(page.getByText('Versão bloqueada: para alterar')).toBeVisible();
  await expect(page.getByText(/Hash do snapshot: [0-9a-f]{64}/)).toBeVisible();

  await page.getByRole('button', { name: 'Verificar integridade' }).click();
  await expect(page.getByText('Integridade verificada')).toBeVisible();

  await page.getByRole('button', { name: 'Nova versão' }).click();
  await expect(page.getByText('Versão 2 — Rascunho')).toBeVisible();
});

test('a regra de licenças obriga a juntar o Suporte Premium', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: 'Propostas' }).click();
  await page.getByRole('button', { name: 'Nova proposta' }).click();
  await page.getByLabel('Título').fill(`Regras e2e ${Date.now()}`);
  await page.getByLabel('Cliente').selectOption({ label: 'Cliente Exemplo, Lda.' });
  await page.getByRole('button', { name: 'Criar' }).click();

  await page.getByLabel('Produto').selectOption({ label: 'LIC-CORE — Licença Plataforma Core' });
  await page.getByRole('button', { name: 'Adicionar linha' }).click();
  await page.getByLabel('Quantidade 1').fill('60');
  await expect(page.getByRole('alert').filter({ hasText: 'Mais de 50 licenças exige Suporte Premium' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar rascunho' })).toBeDisabled();

  await page.getByLabel('Produto').selectOption({ label: 'SUP-PRM — Suporte Premium' });
  await page.getByRole('button', { name: 'Adicionar linha' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Mais de 50 licenças' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Guardar rascunho' })).toBeEnabled();
});
