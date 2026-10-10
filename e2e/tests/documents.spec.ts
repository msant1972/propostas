import { expect, test } from '@playwright/test';

async function login(page: import('@playwright/test').Page, role: string) {
  await page.goto('/login');
  await page.getByLabel('Perfil').selectOption(role);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test('biblioteca de conteúdos → secções → geração de DOCX e PDF → descarga', async ({ page }) => {
  const code = `E2E-${Date.now()}`;

  // 1. o Administrador cria um bloco e outro utilizador (Juridico) aprova-o
  await login(page, 'Administrador');
  await page.getByRole('link', { name: 'Conteúdos' }).click();
  await page.getByRole('button', { name: 'Novo bloco' }).click();
  await page.getByLabel('Código').fill(code);
  await page.getByLabel('Título').fill('Bloco e2e');
  await page.getByRole('textbox', { name: 'Texto' }).click();
  await page.keyboard.type('Proposta para {{cliente.nome}} válida até {{proposta.validade}}.');
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByText('Bloco e2e')).toBeVisible();
  await page.getByRole('button', { name: new RegExp('Bloco e2e') }).click();
  await page.getByRole('button', { name: 'Aprovar' }).click();
  await expect(page.getByText('Aprovada').first()).toBeVisible();

  // 2. o comercial cria a proposta, cota, junta o bloco e a tabela de preços
  await page.getByRole('button', { name: 'Terminar sessão' }).click();
  await login(page, 'Comercial');
  await page.getByRole('link', { name: 'Propostas' }).click();
  await page.getByRole('button', { name: 'Nova proposta' }).click();
  const title = `Documento e2e ${Date.now()}`;
  await page.getByLabel('Título').fill(title);
  await page.getByLabel('Cliente').selectOption({ label: 'Cliente Exemplo, Lda.' });
  await page.getByRole('button', { name: 'Criar' }).click();
  await page.getByLabel('Produto').selectOption({ label: 'IMP-BAS — Implementação Base' });
  await page.getByRole('button', { name: 'Adicionar linha' }).click();
  await page.getByRole('button', { name: 'Guardar rascunho' }).click();
  await expect(page.getByRole('status')).toContainText('Rascunho guardado');

  await page.getByRole('tab', { name: 'Documento' }).click();
  await page.getByLabel('Adicionar da biblioteca').first().selectOption({ label: 'Bloco e2e (pt-PT)' });
  await page.getByRole('button', { name: 'Adicionar da biblioteca' }).click();
  await expect(page.getByTestId('section')).toHaveCount(1);

  await page.getByPlaceholder('Título da nova secção').fill('Preços');
  await page.getByRole('button', { name: 'Secção em branco' }).click();
  await expect(page.getByTestId('section')).toHaveCount(2);
  const prices = page.getByTestId('section').nth(1);
  await prices.getByRole('textbox', { name: 'Preços' }).click();
  await page.keyboard.type('{{tabela_precos}}');
  await prices.getByRole('button', { name: 'Guardar secção' }).click();
  await expect(prices.getByRole('button', { name: 'Guardar secção' })).toBeDisabled();

  // 3. sem validade a proposta não gera: a variável em falta bloqueia
  await page.getByRole('button', { name: 'Gerar documento' }).click();
  await expect(page.getByText('{{proposta.validade}} — MISSING_VALUE')).toBeVisible();
});

test('gera os documentos quando tudo está resolvido', async ({ page, request }) => {
  await login(page, 'Comercial');
  const token = await page.evaluate(() => JSON.parse(sessionStorage.getItem('cpq.session')!).token as string);
  const H = { Authorization: `Bearer ${token}` };

  // proposta com validade, cotação e uma secção sem variáveis em falta
  const clients = await (await request.get('/api/v1/clients?pageSize=100', { headers: H })).json();
  const cli = clients.items.find((c: { code: string }) => c.code === 'CLI-001');
  const prop = await (await request.post('/api/v1/proposals', { headers: H, data: { title: `Gerar e2e ${Date.now()}`, clientId: cli.id, validUntil: '2027-01-31' } })).json();
  const quote = await (await request.get(`/api/v1/proposals/${prop.id}/quotes/current`, { headers: H })).json();
  const catalog = await (await request.get('/api/v1/catalog/products?pageSize=50', { headers: H })).json();
  const imp = catalog.items.find((p: { sku: string }) => p.sku === 'IMP-BAS');
  await request.put(`/api/v1/proposals/${prop.id}/quotes/${quote.id}`, { headers: H, data: { lines: [{ productId: imp.id, quantity: '5' }] } });
  await request.post(`/api/v1/proposals/${prop.id}/sections`, { headers: H, data: { title: 'Resumo' } });
  const [sec] = await (await request.get(`/api/v1/proposals/${prop.id}/sections`, { headers: H })).json();
  await request.put(`/api/v1/proposals/${prop.id}/sections/${sec.id}`, { headers: H, data: { rowVersion: sec.rowVersion, html: '<p>Para {{cliente.nome}}, até {{proposta.validade}}.</p><p>{{tabela_precos}}</p>' } });

  await page.goto(`/propostas/${prop.id}`);
  await page.getByRole('tab', { name: 'Documento' }).click();
  await page.getByRole('button', { name: 'Gerar documento' }).click();

  // o worker (processo separado) gera os ficheiros; a página faz polling até aparecerem
  await expect(page.getByRole('cell', { name: 'DOCX' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('cell', { name: 'PDF' })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Descarregar.*\.pdf/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  expect((await readFile(path)).subarray(0, 5).toString()).toBe('%PDF-');
});
