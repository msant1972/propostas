import { expect, test } from '@playwright/test';
import { login, logout, sessionToken } from './helpers';

test('aprovação em dois níveis → envio → o cliente aceita no portal → comprovativo', async ({ page, request, browser }) => {
  // preparação por API: proposta com desconto de 20 % (obriga a aprovação), cotada e com documento gerado
  await login(page, 'Comercial');
  const H = { Authorization: `Bearer ${await sessionToken(page)}` };
  const clients = await (await request.get('/api/v1/clients?pageSize=100', { headers: H })).json();
  const cli = clients.items.find((c: { code: string }) => c.code === 'CLI-001');
  const prop = await (await request.post('/api/v1/proposals', { headers: H, data: { title: `Aprovação e2e ${Date.now()}`, clientId: cli.id, validUntil: '2099-12-31' } })).json();
  const quote = await (await request.get(`/api/v1/proposals/${prop.id}/quotes/current`, { headers: H })).json();
  const products = await (await request.get('/api/v1/catalog/products?pageSize=100', { headers: H })).json();
  const imp = products.items.find((p: { sku: string }) => p.sku === 'IMP-BAS');
  await request.put(`/api/v1/proposals/${prop.id}/quotes/${quote.id}`, { headers: H, data: { lines: [{ productId: imp.id, quantity: '10', discountPercent: '20' }] } });
  await request.post(`/api/v1/proposals/${prop.id}/sections`, { headers: H, data: { title: 'Resumo' } });
  const [sec] = await (await request.get(`/api/v1/proposals/${prop.id}/sections`, { headers: H })).json();
  await request.put(`/api/v1/proposals/${prop.id}/sections/${sec.id}`, { headers: H, data: { rowVersion: sec.rowVersion, html: '<p>Para {{cliente.nome}}.</p><p>{{tabela_precos}}</p>' } });
  const job = await (await request.post(`/api/v1/proposals/${prop.id}/documents/compile`, { headers: H })).json();
  await expect.poll(async () => (await (await request.get(`/api/v1/proposals/${prop.id}/documents/jobs/${job.eventId}`, { headers: H })).json()).status, { timeout: 20_000 }).toBe('DONE');

  // 1. o comercial submete para revisão e para aprovação
  await page.goto(`/propostas/${prop.id}`);
  await page.getByRole('button', { name: 'Submeter para revisão' }).click();
  await expect(page.getByTestId('status')).toHaveText('Em revisão');
  await page.getByRole('button', { name: 'Submeter para aprovação' }).click();
  await expect(page.getByTestId('status')).toHaveText('Aguarda aprovação');
  await page.goto('/aprovacoes');
  await expect(page.getByRole('link', { name: new RegExp(prop.code) })).toHaveCount(0); // o dono não decide o próprio pedido
  await logout(page);

  // 2. o gestor aprova o nível 1
  await login(page, 'Gestor_Comercial');
  await page.goto('/aprovacoes');
  await page.getByRole('link', { name: new RegExp(prop.code) }).click();
  await expect(page.getByText('Nível 1 de 2')).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar' }).click();
  await expect(page.getByRole('status')).toContainText('Decisão registada');
  await logout(page);

  // 3. o financeiro aprova o nível 2: a proposta fica aprovada
  await login(page, 'Aprovador_Financeiro');
  await page.goto('/aprovacoes');
  await page.getByRole('link', { name: new RegExp(prop.code) }).click();
  await expect(page.getByText('Nível 2 de 2')).toBeVisible();
  await page.getByRole('button', { name: 'Aprovar' }).click();
  await expect(page.getByRole('status')).toContainText('Decisão registada');
  await logout(page);

  // 4. o comercial envia e cria a ligação do portal
  await login(page, 'Comercial');
  await page.goto(`/propostas/${prop.id}`);
  await expect(page.getByTestId('status')).toHaveText('Aprovada');
  await page.getByRole('button', { name: 'Enviar ao cliente' }).click();
  await expect(page.getByTestId('status')).toHaveText('Enviada');
  await page.getByRole('tab', { name: 'Portal do cliente' }).click();
  await page.getByRole('button', { name: 'Criar sem enviar' }).click();
  const url = (await page.getByTestId('portal-url').textContent())!.trim();
  expect(url).toMatch(/\/portal\/[A-Za-z0-9_-]{43}$/);

  // 5. o cliente, sem conta, abre a ligação e aceita
  const clientCtx = await browser.newContext();
  const portal = await clientCtx.newPage();
  await portal.goto(new URL(new URL(url).pathname, 'http://localhost:5173').toString());
  await expect(portal.getByRole('heading', { name: new RegExp('Aprovação e2e') })).toBeVisible();
  await expect(portal.locator('iframe')).toBeVisible();
  await portal.getByLabel('Nome completo').fill('Rui Silva');
  await portal.getByLabel('Email').fill('rui.silva@cliente.pt');
  await expect(portal.getByRole('button', { name: 'Enviar resposta' })).toBeDisabled(); // falta confirmar a leitura
  await portal.getByLabel('Li o documento acima').check();
  await portal.getByRole('button', { name: 'Enviar resposta' }).click();
  await expect(portal.getByRole('heading', { name: 'Proposta aceite. Obrigado!' })).toBeVisible();
  await clientCtx.close();

  // 6. o comercial vê a proposta aceite, a resposta e o comprovativo (gerado pelo worker)
  await page.reload();
  await expect(page.getByTestId('status')).toHaveText('Aceite');
  await page.getByRole('tab', { name: 'Portal do cliente' }).click();
  await expect(page.getByTestId('link').first()).toContainText('Aceite por Rui Silva');
  await page.getByRole('tab', { name: 'Documento' }).click();
  await expect(page.getByRole('button', { name: /comprovativo_aceitacao.*\.pdf/ })).toBeVisible({ timeout: 20_000 });
});
