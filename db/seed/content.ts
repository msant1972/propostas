/**
 * Conteúdos de exemplo para a biblioteca (ambiente de testes). Os valores técnicos são indicativos e devem
 * ser confirmados na ficha técnica do fabricante em vigor; as condições gerais são um modelo a validar pelo Jurídico.
 */
export interface SeedBlock {
  code: string;
  title: string;
  isLegal: boolean;
  tags: string[];
  html: string;
}

export const SEED_BLOCKS: SeedBlock[] = [
  {
    code: 'CAPA',
    title: 'Capa da proposta',
    isLegal: false,
    tags: ['capa', 'geral'],
    html: `
<p><strong>Proposta {{proposta.codigo}}</strong></p>
<h2>{{proposta.titulo}}</h2>
<p>Preparada para <strong>{{cliente.nome}}</strong></p>
<table>
  <tr><th>Data de emissão</th><td>{{data.hoje}}</td></tr>
  <tr><th>Válida até</th><td>{{proposta.validade}}</td></tr>
  <tr><th>Versão da cotação</th><td>{{cotacao.versao}}</td></tr>
  <tr><th>Moeda</th><td>{{proposta.moeda}}</td></tr>
</table>
<p><em>Documento confidencial, destinado exclusivamente ao destinatário indicado. A sua reprodução ou divulgação a terceiros sem autorização prévia não é permitida.</em></p>`,
  },
  {
    code: 'SWITCH-48P',
    title: 'Descrição: switch de 48 portas',
    isLegal: false,
    tags: ['hardware', 'switch', 'rede'],
    html: `
<h2>Switch de acesso de 48 portas Gigabit</h2>
<p>Switch gerido de camada 2/3 leve, pensado para o acesso de utilizadores e dispositivos em redes empresariais. Reúne <strong>48 portas Gigabit Ethernet</strong> com ligações ascendentes de alta velocidade, num formato de 1U para bastidor de 19".</p>
<h3>Características principais</h3>
<ul>
  <li>48 portas 10/100/1000BASE-T para ligação de postos de trabalho, telefones IP, pontos de acesso Wi-Fi e câmaras.</li>
  <li>4 portas SFP+ de 10 Gbps para ligações ascendentes ao núcleo da rede ou empilhamento.</li>
  <li>Comutação a velocidade de linha (<em>non-blocking</em>) em todas as portas.</li>
  <li>VLAN 802.1Q, agregação de ligações LACP (802.3ad), Spanning Tree (RSTP/MSTP) e qualidade de serviço (QoS) por porta e por classe.</li>
  <li>Segurança de acesso: autenticação 802.1X, listas de controlo de acesso (ACL), proteção contra <em>loops</em> e DHCP snooping.</li>
  <li>Gestão por interface web, linha de comandos (SSH) e SNMP v2c/v3, com registo remoto (<em>syslog</em>).</li>
  <li>Fontes de alimentação e ventoinhas de baixo ruído, adequadas a ambientes de escritório e a bastidores técnicos.</li>
</ul>
<h3>Variante com alimentação por Ethernet (PoE+)</h3>
<p>Na variante PoE+ (IEEE 802.3at), as portas de cobre fornecem até 30 W por porta, dentro do orçamento de potência total do equipamento, eliminando fontes de alimentação individuais em telefones IP e pontos de acesso. O orçamento de potência deve ser dimensionado em função dos dispositivos a alimentar.</p>
<h3>Instalação e serviços incluídos</h3>
<ol>
  <li>Montagem em bastidor e ligação à rede existente.</li>
  <li>Configuração base: VLAN, gestão, segurança de acesso e monitorização.</li>
  <li>Documentação da configuração e passagem de conhecimento à equipa do cliente.</li>
</ol>
<p><em>As especificações apresentadas são genéricas; as características exatas dependem do modelo proposto e constam da respetiva ficha técnica do fabricante.</em></p>`,
  },
  {
    code: 'FW-FORTIGATE-100F',
    title: 'Descrição: firewall Fortinet FortiGate 100F',
    isLegal: false,
    tags: ['hardware', 'firewall', 'seguranca', 'fortinet'],
    html: `
<h2>Firewall de nova geração Fortinet FortiGate 100F</h2>
<p>O <strong>FortiGate 100F</strong> é uma firewall de nova geração (NGFW) para sucursais e pequenas e médias empresas, que combina encaminhamento, segurança e ligação SD-WAN num único equipamento, assente em processadores de segurança dedicados da Fortinet e no sistema operativo FortiOS.</p>
<h3>Capacidades de segurança</h3>
<ul>
  <li>Firewall com inspeção de estado e controlo de aplicações com identificação de utilizadores e dispositivos.</li>
  <li>Prevenção de intrusões (IPS), antivírus, filtragem web e DNS, e controlo de aplicações atualizados pelos serviços FortiGuard.</li>
  <li>Inspeção de tráfego cifrado (SSL/TLS) e proteção contra ameaças avançadas e <em>botnets</em>.</li>
  <li>VPN IPsec e SSL para acesso remoto seguro e ligações entre sedes.</li>
  <li>SD-WAN integrada, com escolha dinâmica de caminho por qualidade de ligação e por aplicação.</li>
</ul>
<h3>Desempenho de referência</h3>
<table>
  <tr><th>Indicador</th><th>Valor indicativo</th></tr>
  <tr><td>Débito de firewall</td><td>até 20 Gbps</td></tr>
  <tr><td>Débito de IPS</td><td>cerca de 2,6 Gbps</td></tr>
  <tr><td>Débito de NGFW</td><td>cerca de 1,6 Gbps</td></tr>
  <tr><td>Proteção contra ameaças (UTM)</td><td>cerca de 1 Gbps</td></tr>
  <tr><td>Débito de VPN IPsec</td><td>cerca de 11,5 Gbps</td></tr>
  <tr><td>Sessões simultâneas</td><td>cerca de 1,5 milhões</td></tr>
</table>
<p><em>Valores indicativos da ficha técnica do fabricante, medidos em condições de laboratório; o desempenho real depende dos serviços de segurança ativados e do perfil de tráfego.</em></p>
<h3>Interfaces</h3>
<p>Portas Ethernet de cobre Gigabit (incluindo WAN, DMZ, gestão e alta disponibilidade) e portas SFP para fibra, com suporte a alta disponibilidade em modo ativo-passivo ou ativo-ativo.</p>
<h3>Licenciamento e suporte</h3>
<p>O equipamento pode ser fornecido com subscrição de serviços de segurança FortiGuard (por exemplo, o pacote <em>Unified Threat Protection</em>) e suporte do fabricante, renovável anualmente. A subscrição é necessária para manter as assinaturas de segurança atualizadas.</p>
<h3>Implementação</h3>
<ol>
  <li>Levantamento da rede e das políticas de segurança atuais.</li>
  <li>Instalação, configuração de políticas, VPN e perfis de segurança.</li>
  <li>Testes de aceitação, documentação e formação à equipa do cliente.</li>
</ol>`,
  },
  {
    code: 'CONDICOES-GERAIS',
    title: 'Condições gerais',
    isLegal: true,
    tags: ['condicoes', 'juridico', 'geral'],
    html: `
<h2>1. Objeto e âmbito</h2>
<p>As presentes condições gerais aplicam-se à proposta {{proposta.codigo}}, emitida a {{data.hoje}} a favor de {{cliente.nome}}, e regulam o fornecimento dos bens e serviços nela descritos.</p>
<h2>2. Validade da proposta</h2>
<p>Esta proposta é válida até {{proposta.validade}}. Decorrido esse prazo, os preços e as condições podem ser revistos.</p>
<h2>3. Preços e impostos</h2>
<p>Os preços constam da tabela de preços da proposta, expressos em {{proposta.moeda}}, e não incluem IVA, que será acrescido à taxa legal em vigor, salvo indicação em contrário. O valor total da proposta é de {{cotacao.total}}.</p>
<h2>4. Condições de pagamento</h2>
<ul>
  <li>Bens e serviços pontuais: faturação na entrega ou na conclusão, com pagamento a 30 dias após a data da fatura.</li>
  <li>Serviços recorrentes (subscrições, licenças e suporte): faturação antecipada, de acordo com a periodicidade contratada.</li>
  <li>Os atrasos no pagamento vencem juros de mora à taxa legal aplicável às transações comerciais.</li>
</ul>
<h2>5. Prazos de entrega e execução</h2>
<p>Os prazos indicados são estimativas de boa-fé e contam a partir da aceitação da proposta e da disponibilização das informações e acessos necessários pelo cliente. Não constituem prazos essenciais, salvo acordo escrito em contrário.</p>
<h2>6. Garantia</h2>
<p>O hardware beneficia da garantia do fabricante, nos termos e prazos por este definidos. Os serviços de instalação e configuração têm garantia de conformidade durante 90 dias após a conclusão. A garantia não cobre danos resultantes de uso indevido, alterações não autorizadas ou causas externas.</p>
<h2>7. Propriedade e licenciamento</h2>
<p>A propriedade dos bens só se transmite com o pagamento integral do preço. O software e as subscrições são licenciados, não vendidos, e ficam sujeitos aos termos de licenciamento dos respetivos fabricantes.</p>
<h2>8. Confidencialidade</h2>
<p>As partes obrigam-se a manter confidencial toda a informação não pública a que tenham acesso por força desta proposta, durante a sua vigência e nos cinco anos seguintes, salvo obrigação legal de divulgação.</p>
<h2>9. Limitação de responsabilidade</h2>
<p>Salvo em caso de dolo ou negligência grosseira, a responsabilidade total do fornecedor perante o cliente, por qualquer causa, fica limitada ao valor pago pelo fornecimento que deu origem ao dano. Excluem-se lucros cessantes e danos indiretos.</p>
<h2>10. Proteção de dados pessoais</h2>
<p>Cada parte trata os dados pessoais da outra, necessários à execução desta proposta, em conformidade com o Regulamento (UE) 2016/679 (RGPD) e a legislação nacional aplicável. Quando o fornecedor tratar dados pessoais por conta do cliente, será celebrado o respetivo acordo de subcontratação.</p>
<h2>11. Lei aplicável e foro</h2>
<p>A proposta rege-se pela lei portuguesa. Para a resolução de litígios é competente o foro da comarca de Lisboa, com renúncia a qualquer outro.</p>
<p><em>Modelo de condições gerais para efeitos de teste; deve ser revisto e validado pelo Jurídico antes de utilização comercial.</em></p>`,
  },
];

export const SEED_PRODUCTS: Array<{ sku: string; name: string; description: string; billingModel: 'ONE_TIME' | 'RECURRING'; billingPeriod: 'YEAR' | null; unitCost: string; price: string }> = [
  { sku: 'SW-48G', name: 'Switch 48 portas Gigabit (4×SFP+)', description: 'Switch gerido de acesso, 48×1G + 4×10G SFP+, 1U.', billingModel: 'ONE_TIME', billingPeriod: null, unitCost: '780.0000', price: '1190.0000' },
  { sku: 'SW-48G-POE', name: 'Switch 48 portas Gigabit PoE+ (4×SFP+)', description: 'Variante PoE+ do switch de 48 portas.', billingModel: 'ONE_TIME', billingPeriod: null, unitCost: '1450.0000', price: '2150.0000' },
  { sku: 'FW-FG100F', name: 'Firewall Fortinet FortiGate 100F', description: 'Firewall de nova geração FortiGate 100F (hardware).', billingModel: 'ONE_TIME', billingPeriod: null, unitCost: '1650.0000', price: '2490.0000' },
  { sku: 'FW-FG100F-UTP', name: 'FortiGate 100F — Unified Threat Protection (1 ano)', description: 'Subscrição FortiGuard UTP e suporte do fabricante, por ano.', billingModel: 'RECURRING', billingPeriod: 'YEAR', unitCost: '720.0000', price: '1080.0000' },
  { sku: 'SRV-INST-REDE', name: 'Instalação e configuração de equipamento de rede', description: 'Montagem, configuração base e documentação, por equipamento.', billingModel: 'ONE_TIME', billingPeriod: null, unitCost: '160.0000', price: '280.0000' },
];
