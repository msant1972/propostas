import { expect, test } from '@playwright/test';
import { login } from './helpers';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==';
const SRC = `data:image/png;base64,${PNG}`;

// HTML como o Word o põe na área de transferência: classes Mso, estilos, parágrafos nas células, uma imagem local (file:///) que o browser não lê e uma imagem em base64
const WORD_HTML = `<html><body><!--StartFragment--><p class="MsoNormal" style="margin:0cm"><b>Âmbito dos serviços</b><o:p></o:p></p>
<table class="MsoTableGrid" border="1" style="border-collapse:collapse"><tr><td style="width:100pt"><p class="MsoNormal">Item</p></td><td><p class="MsoNormal">Preço</p></td></tr>
<tr><td><p class="MsoNormal">Switch 48p</p></td><td><p class="MsoNormal">1.200 EUR</p></td></tr></table>
<p><img src="file:///C:/Users/ana/AppData/Local/Temp/msohtmlclip1/01/clip_image001.png" width="120" height="80"></p>
<p><img src="${SRC}" width="2" height="2"></p><!--EndFragment--></body></html>`;

test('conteúdos: colar tabela e imagens do Word, inserir imagem por ficheiro e gerar o documento com elas', async ({ page }) => {
  const code = `RICO-${Date.now()}`;
  await login(page, 'Administrador');
  await page.getByRole('link', { name: 'Conteúdos' }).click();
  await page.getByRole('button', { name: 'Novo bloco' }).click();
  await page.getByLabel('Código', { exact: true }).fill(code);
  await page.getByLabel('Título', { exact: true }).fill(`Rico ${code}`);

  const editor = page.getByRole('textbox', { name: 'Texto' });
  await editor.click();
  await editor.evaluate((el, html) => {
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', 'Âmbito dos serviços');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, WORD_HTML);

  // a tabela e a imagem em base64 ficam; a ligação local é removida com um aviso claro
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('tr')).toHaveCount(2);
  await expect(editor.locator('img')).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: 'não pôde ser colada' })).toBeVisible();

  // inserir uma imagem a partir de um ficheiro
  await page.getByTestId('editor-image-input').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
  await expect(editor.locator('img')).toHaveCount(2);

  // as ferramentas da tabela aparecem quando o cursor está numa célula
  await editor.locator('td').first().click();
  await page.getByRole('button', { name: 'Adicionar linha abaixo' }).click();
  await expect(editor.locator('tr')).toHaveCount(3);

  await page.getByRole('button', { name: 'Criar' }).click();
  await page.getByRole('button', { name: new RegExp(`Rico ${code}`) }).click();
  await page.getByRole('button', { name: 'Aprovar' }).click();
  await expect(page.getByText('Aprovada').first()).toBeVisible();
  await expect(page.locator('.prose-view img')).toHaveCount(2);
  await expect(page.locator('.prose-view table')).toHaveCount(1);
});
