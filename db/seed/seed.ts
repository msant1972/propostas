import 'dotenv/config';
import { DEMO_PASSWORD, DEMO_USERS, hashPassword, uuidv7 } from '@cpq/shared';
import { createPrisma } from '../src/index.js';
import { SEED_BLOCKS, SEED_PRODUCTS } from './content.js';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL em falta');
const prisma = createPrisma(url);

const products: Array<[string, string, 'ONE_TIME' | 'RECURRING' | 'USAGE_BASED' | 'MILESTONE', 'MONTH' | 'YEAR' | null, string, string]> = [
  ['LIC-CORE', 'Licença Plataforma Core', 'RECURRING', 'MONTH', 'UN', '12.0000'],
  ['LIC-PRO', 'Licença Plataforma Pro', 'RECURRING', 'MONTH', 'UN', '25.0000'],
  ['LIC-ENT', 'Licença Plataforma Enterprise', 'RECURRING', 'YEAR', 'UN', '600.0000'],
  ['SUP-STD', 'Suporte Standard', 'RECURRING', 'MONTH', 'UN', '3.0000'],
  ['SUP-PRM', 'Suporte Premium', 'RECURRING', 'MONTH', 'UN', '8.0000'],
  ['IMP-BAS', 'Implementação Base', 'ONE_TIME', null, 'H', '45.0000'],
  ['IMP-INT', 'Integração com ERP', 'MILESTONE', null, 'H', '55.0000'],
  ['CON-SEN', 'Consultoria Sénior', 'ONE_TIME', null, 'H', '70.0000'],
  ['CON-JUN', 'Consultoria Júnior', 'ONE_TIME', null, 'H', '35.0000'],
  ['FOR-ONL', 'Formação Online', 'ONE_TIME', null, 'H', '30.0000'],
  ['FOR-PRE', 'Formação Presencial', 'ONE_TIME', null, 'H', '50.0000'],
  ['API-USO', 'Chamadas API (milhares)', 'USAGE_BASED', null, 'MIL', '0.4000'],
  ['ARM-GB', 'Armazenamento adicional', 'USAGE_BASED', null, 'GB', '0.0200'],
  ['MOD-REL', 'Módulo de Relatórios', 'RECURRING', 'MONTH', 'UN', '6.0000'],
  ['MOD-WFL', 'Módulo de Workflow', 'RECURRING', 'MONTH', 'UN', '9.0000'],
  ['MOD-SEG', 'Módulo de Segurança Avançada', 'RECURRING', 'MONTH', 'UN', '11.0000'],
  ['SLA-99', 'SLA 99,9 %', 'RECURRING', 'YEAR', 'UN', '900.0000'],
  ['AUD-SEG', 'Auditoria de Segurança', 'ONE_TIME', null, 'UN', '2500.0000'],
  ['MIG-DAD', 'Migração de Dados', 'MILESTONE', null, 'H', '50.0000'],
  ['HOS-GER', 'Alojamento Gerido', 'RECURRING', 'MONTH', 'UN', '150.0000'],
];

const teamIds = { norte: '00000000-0000-4000-8000-0000000000a1', sul: '00000000-0000-4000-8000-0000000000a2' };

async function main() {
  for (const [name, id] of [['Norte', teamIds.norte], ['Sul', teamIds.sul]] as const) {
    await prisma.team.upsert({ where: { id }, update: { name }, create: { id, name } });
  }
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const u of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { displayName: u.name, rolesJson: [u.role] },
      create: { id: uuidv7(), email: u.email, displayName: u.name, rolesJson: [u.role], teamId: teamIds.norte, region: 'PT', passwordHash, passwordChangedAt: new Date() },
    });
  }
  for (const [sku, name, billingModel, billingPeriod, unitOfMeasure, unitCost] of products) {
    await prisma.product.upsert({
      where: { sku },
      update: {},
      create: { id: uuidv7(), sku, name, billingModel, billingPeriod, unitOfMeasure, unitCost },
    });
  }

  // Preços, impostos, regra e cliente de exemplo, para o ambiente de testes ser utilizável de imediato.
  const byEmpty = await prisma.priceList.count();
  if (byEmpty === 0) {
    const all = await prisma.product.findMany();
    const listId = uuidv7();
    await prisma.priceList.create({ data: { id: listId, name: 'Geral EUR', currency: 'EUR', validFrom: new Date('2026-01-01') } });
    const items = all.flatMap((p) => {
      const price = (Number(p.unitCost) * 2).toFixed(4);
      const rows = [{ id: uuidv7(), priceListId: listId, productId: p.id, minQuantity: '0', unitPrice: price }];
      if (p.sku === 'LIC-CORE') rows.push({ id: uuidv7(), priceListId: listId, productId: p.id, minQuantity: '50', unitPrice: (Number(price) * 0.9).toFixed(4) });
      return rows;
    });
    await prisma.priceListItem.createMany({ data: items });

    for (const [taxCategory, regime, ratePercent] of [['STANDARD', 'STANDARD', '23.00'], ['REDUCED', 'REDUCED', '6.00']] as const) {
      await prisma.taxRate.create({ data: { id: uuidv7(), countryCode: 'PT', taxCategory, regime, ratePercent, validFrom: new Date('2020-01-01') } });
    }
    await prisma.fxRate.create({ data: { id: uuidv7(), baseCurrency: 'USD', quoteCurrency: 'EUR', rate: '0.92000000', rateDate: new Date('2026-10-01'), source: 'seed' } });

    const core = all.find((p) => p.sku === 'LIC-CORE')!;
    const premium = all.find((p) => p.sku === 'SUP-PRM')!;
    await prisma.cpqRule.create({
      data: {
        id: uuidv7(), sourceProductId: core.id, targetProductId: premium.id, ruleType: 'REQUIRES',
        conditionJson: { '>': [{ var: 'source.quantity' }, 50] }, message: 'Mais de 50 licenças exige Suporte Premium',
        validFrom: new Date('2026-01-01'),
      },
    });
    await prisma.client.create({
      data: { id: uuidv7(), code: 'CLI-001', name: 'Cliente Exemplo, Lda.', vatNumber: '500000000', countryCode: 'PT', vatValid: true },
    });
  }

  // Produtos de rede e segurança (idempotente por SKU), com preço na lista geral.
  const list = await prisma.priceList.findFirst({ where: { name: 'Geral EUR' } });
  for (const p of SEED_PRODUCTS) {
    const prod = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: { id: uuidv7(), sku: p.sku, name: p.name, description: p.description, billingModel: p.billingModel, billingPeriod: p.billingPeriod, unitCost: p.unitCost },
    });
    if (list && !(await prisma.priceListItem.count({ where: { priceListId: list.id, productId: prod.id } }))) {
      await prisma.priceListItem.create({ data: { id: uuidv7(), priceListId: list.id, productId: prod.id, minQuantity: '0', unitPrice: p.price } });
    }
  }

  // Biblioteca de conteúdos de exemplo: versões já aprovadas, para se poderem usar de imediato.
  const owner = await prisma.user.findFirstOrThrow({ where: { email: DEMO_USERS.find((u) => u.role === 'Administrador')!.email } });
  const reviewDue = new Date(Date.now() + 365 * 864e5);
  for (const b of SEED_BLOCKS) {
    if (await prisma.contentBlock.findUnique({ where: { code: b.code } })) continue;
    const blockId = uuidv7();
    await prisma.contentBlock.create({ data: { id: blockId, code: b.code, title: b.title, isLegal: b.isLegal, ownerUserId: owner.id } });
    await prisma.contentBlockVersion.create({
      data: { id: uuidv7(), blockId, language: 'pt-PT', versionNumber: 1, status: 'APPROVED', bodyHtml: b.html.trim(), reviewDueDate: reviewDue, createdBy: owner.id },
    });
    for (const name of b.tags) {
      const tag = (await prisma.tag.findUnique({ where: { name } })) ?? (await prisma.tag.create({ data: { id: uuidv7(), name } }));
      await prisma.contentBlockTag.create({ data: { blockId, tagId: tag.id } });
    }
  }


  // Políticas de aprovação de exemplo (os limites são ilustrativos e devem ser definidos pela direção financeira).
  const policies = [
    {
      name: 'Comercial — desconto, margem ou valor', scope: 'COMMERCIAL' as const, mode: 'SEQUENTIAL' as const, priority: 100,
      condition: { or: [{ '>': [{ var: 'max_line_discount_percent' }, 15] }, { '<': [{ var: 'margin_percent' }, 25] }, { '>': [{ var: 'grand_total' }, 100000] }] },
      levels: [
        { level: 1, role: 'Gestor_Comercial', slaHours: 24, escalateToRole: 'Aprovador_Financeiro' },
        { level: 2, role: 'Aprovador_Financeiro', slaHours: 48, escalateToRole: 'Administrador' },
      ],
    },
    {
      name: 'Jurídico — cláusulas alteradas', scope: 'LEGAL' as const, mode: 'SEQUENTIAL' as const, priority: 100,
      condition: { '==': [{ var: 'has_modified_legal_section' }, true] },
      levels: [{ level: 1, role: 'Juridico', slaHours: 48, escalateToRole: 'Administrador' }],
    },
  ];
  for (const pol of policies) {
    if (await prisma.approvalPolicy.findFirst({ where: { name: pol.name } })) continue;
    await prisma.approvalPolicy.create({
      data: { id: uuidv7(), name: pol.name, scope: pol.scope, mode: pol.mode, priority: pol.priority, conditionJson: pol.condition as never, levelsJson: pol.levels as never, validFrom: new Date('2026-01-01') },
    });
  }

  console.log(`seed: ${products.length + SEED_PRODUCTS.length} produtos, ${SEED_BLOCKS.length} blocos de conteúdo, 2 políticas de aprovação, ${DEMO_USERS.length} utilizadores, 2 equipas`);
}

await main().finally(() => prisma.$disconnect());
