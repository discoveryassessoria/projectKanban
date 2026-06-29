// src/components/gerenciamentoComponents/gerenciamentoCatalogs.ts
// Config dos catálogos genéricos do Gerenciamento — portado de MG_CATALOG do mockup Operacional.
// Cada chave corresponde a um item de menu "cat:<key>" e alimenta o <CatalogTab catalogKey="..." />.
// cols = colunas da tabela [chave, rótulo]. fields = campos do modal de criar/editar.
// optionsSource = tabela de origem do select (será ligada a dados reais na etapa de wiring).

export type CatalogFieldType = 'text' | 'number' | 'select' | 'bool' | 'boolean'

export type CatalogField = {
  key: string
  label: string
  type: CatalogFieldType
  required?: boolean
  options?: string[]
  optionsSource?: string
}

export type CatalogConfig = {
  path: string
  title: string
  desc: string
  cols: [string, string][]
  fields: CatalogField[]
  technicalOnly?: boolean
}

export const MG_CATALOG: Record<string, CatalogConfig> = {
  // ---------- DOCUMENTOS ----------
  op_doctypes: {
    path: 'operational.documentTypes',
    title: 'Tipos de Documento',
    desc: 'Tipos documentais usados nos processos.',
    cols: [['code', 'Código'], ['name', 'Nome'], ['category', 'Categoria']],
    fields: [
      { key: 'code', label: 'Código', type: 'text' },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'category', label: 'Categoria', type: 'select', options: ['civil_registry', 'identity', 'judicial', 'consular', 'translation', 'apostille', 'other'] },
    ],
  },
  op_docrules: {
    path: 'operational.documentRules',
    title: 'Regras Documentais',
    desc: 'Quando um documento é exigido.',
    cols: [['name', 'Nome'], ['nationality', 'Nac.'], ['_req', 'Obrigatório']],
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'documentTypeId', label: 'Tipo de documento', type: 'select', optionsSource: 'operational.documentTypes' },
      { key: 'required', label: 'Obrigatório', type: 'bool' },
    ],
  },

  // ---------- PROTOCOLO E ÓRGÃOS ----------
  op_organs: {
    path: 'operational.organs',
    title: 'Órgãos',
    desc: 'Consulados, comunes, tribunais, conservatórias, cartórios.',
    cols: [['name', 'Nome'], ['type', 'Tipo'], ['nationality', 'Nac.'], ['city', 'Cidade']],
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'type', label: 'Tipo', type: 'select', options: ['consulado', 'comune', 'tribunal', 'conservatoria', 'cartorio', 'ministerio', 'prefeitura', 'tradutor', 'apostilamento', 'outro'] },
      { key: 'country', label: 'País', type: 'text' },
      { key: 'state', label: 'Estado', type: 'text' },
      { key: 'city', label: 'Cidade', type: 'text' },
      { key: 'queueRule', label: 'Regra de fila', type: 'text' },
    ],
  },

  // OPERACIONAL — Tipos de Certidão e Tipos de Protocolo
  'op_certtypes': {
    path: 'operational.certificationTypes',
    title: 'Tipos de Certidão',
    desc: 'Tipos de certidão usados nos processos (nascimento, casamento, óbito, etc.).',
    cols: [['code', 'Código'], ['name', 'Nome'], ['category', 'Categoria'], ['country', 'País']],
    fields: [
      { key: 'code', label: 'Código', type: 'text' },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'category', label: 'Categoria', type: 'select', options: ['nascimento', 'casamento', 'obito', 'divorcio', 'averbacao', 'inteiro_teor', 'negativa', 'outro'] },
      { key: 'country', label: 'País de origem', type: 'text' },
      { key: 'notes', label: 'Observações', type: 'text' },
    ],
  },
  'op_prottypes': {
    path: 'operational.protocolTypes',
    title: 'Tipos de Protocolo',
    desc: 'Tipos de protocolo (consular, judicial, comune, administrativo, etc.).',
    cols: [['code', 'Código'], ['name', 'Nome'], ['scope', 'Escopo']],
    fields: [
      { key: 'code', label: 'Código', type: 'text' },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'scope', label: 'Escopo padrão', type: 'select', options: ['person', 'process', 'consular_case', 'comune_case', 'judicial_case'] },
      { key: 'nationality', label: 'Nacionalidade aplicável', type: 'text' },
      { key: 'notes', label: 'Observações', type: 'text' },
    ],
  },

  // ---------- FORNECEDORES ----------
  fin_suppliers: {
    path: 'financial.suppliers',
    title: 'Fornecedores',
    desc: 'Cartórios, tradutores, apostilamento, correspondentes.',
    cols: [['name', 'Nome'], ['type', 'Tipo'], ['country', 'País'], ['defaultCurrency', 'Moeda']],
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'type', label: 'Tipo', type: 'select', options: ['registry_office', 'translator', 'apostille_service', 'lawyer', 'correspondent', 'courier', 'consultant', 'government_fee', 'software', 'office', 'other'] },
      { key: 'documentNumber', label: 'Documento', type: 'text' },
      { key: 'email', label: 'E-mail', type: 'text' },
      { key: 'phone', label: 'Telefone', type: 'text' },
      { key: 'country', label: 'País', type: 'text' },
      { key: 'defaultCurrency', label: 'Moeda', type: 'select', options: ['BRL', 'EUR', 'USD'] },
    ],
  },

  // ---------- FINANCEIRO ----------
  fin_currencies: {
    path: 'financial.currencies',
    title: 'Moedas',
    desc: 'Moedas usadas no sistema.',
    cols: [['code', 'Código'], ['name', 'Nome'], ['symbol', 'Símbolo']],
    fields: [
      { key: 'code', label: 'Código', type: 'text', required: true },
      { key: 'name', label: 'Nome', type: 'text' },
      { key: 'symbol', label: 'Símbolo', type: 'text' },
    ],
  },
  fin_fx: {
    path: 'financial.exchangeRates',
    title: 'Câmbio',
    desc: 'Cotações entre moedas.',
    cols: [['fromCurrency', 'De'], ['toCurrency', 'Para'], ['_rate', 'Taxa'], ['date', 'Data'], ['source', 'Fonte']],
    fields: [
      { key: 'fromCurrency', label: 'De', type: 'select', options: ['EUR', 'BRL', 'USD'] },
      { key: 'toCurrency', label: 'Para', type: 'select', options: ['EUR', 'BRL', 'USD'] },
      { key: 'rate', label: 'Taxa', type: 'number' },
      { key: 'date', label: 'Data', type: 'text' },
      { key: 'source', label: 'Fonte', type: 'text' },
    ],
  },
  fin_methods: {
    path: 'financial.paymentMethods',
    title: 'Formas de Pagamento',
    desc: 'Métodos aceitos para cobrança.',
    cols: [['code', 'Código'], ['name', 'Nome'], ['type', 'Tipo'], ['currency', 'Moeda'], ['_inst', 'Parcela']],
    fields: [
      { key: 'code', label: 'Código', type: 'text' },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'type', label: 'Tipo', type: 'select', options: ['pix', 'bank_transfer', 'boleto', 'credit_card', 'debit_card', 'cash', 'international_transfer', 'payment_link', 'paypal', 'wise', 'other'] },
      { key: 'currency', label: 'Moeda', type: 'select', options: ['BRL', 'EUR', 'USD'] },
      { key: 'allowsInstallments', label: 'Permite parcelas', type: 'bool' },
      { key: 'maxInstallments', label: 'Máx. parcelas', type: 'number' },
    ],
  },
  fin_fees: {
    path: 'financial.paymentFees',
    title: 'Taxas de Pagamento',
    desc: 'Taxas de cartão, antecipação, gateway, boleto.',
    cols: [['code', 'Código'], ['name', 'Nome'], ['feeType', 'Tipo'], ['_pct', '%'], ['currency', 'Moeda']],
    fields: [
      { key: 'code', label: 'Código', type: 'text' },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'paymentMethodId', label: 'Forma de pagamento', type: 'select', optionsSource: 'financial.paymentMethods' },
      { key: 'currency', label: 'Moeda', type: 'select', options: ['BRL', 'EUR', 'USD'] },
      { key: 'feeType', label: 'Tipo', type: 'select', options: ['percentage', 'fixed', 'percentage_plus_fixed', 'installment_based', 'custom'] },
      { key: 'feePercent', label: '% taxa', type: 'number' },
      { key: 'fixedFee', label: 'Taxa fixa', type: 'number' },
      { key: 'anticipationEnabled', label: 'Antecipação', type: 'bool' },
      { key: 'anticipationPercent', label: '% antecipação', type: 'number' },
      { key: 'installmentsFrom', label: 'Parcela de', type: 'number' },
      { key: 'installmentsTo', label: 'Parcela até', type: 'number' },
    ],
  },
  fin_banks: {
    path: 'financial.banks',
    title: 'Bancos',
    desc: 'Bancos usados para contas e recebimentos.',
    cols: [['code', 'Código'], ['name', 'Nome'], ['shortName', 'Sigla'], ['country', 'País']],
    fields: [
      { key: 'code', label: 'Código', type: 'text' },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'shortName', label: 'Sigla', type: 'text' },
      { key: 'country', label: 'País', type: 'text' },
      { key: 'website', label: 'Site', type: 'text' },
    ],
  },
  fin_accounts: {
    path: 'financial.bankAccounts',
    title: 'Contas Bancárias',
    desc: 'Contas da empresa para recebimento e pagamento.',
    cols: [['accountName', 'Conta'], ['_bank', 'Banco'], ['accountType', 'Tipo'], ['currency', 'Moeda'], ['_default', 'Padrão']],
    fields: [
      { key: 'accountName', label: 'Nome da conta', type: 'text', required: true },
      { key: 'bankId', label: 'Banco', type: 'select', optionsSource: 'financial.banks' },
      { key: 'accountType', label: 'Tipo', type: 'select', options: ['checking', 'savings', 'digital', 'international', 'cash', 'payment_gateway', 'wallet'] },
      { key: 'currency', label: 'Moeda', type: 'select', options: ['BRL', 'EUR', 'USD'] },
      { key: 'agency', label: 'Agência', type: 'text' },
      { key: 'accountNumber', label: 'Número', type: 'text' },
      { key: 'iban', label: 'IBAN', type: 'text' },
      { key: 'swift', label: 'SWIFT', type: 'text' },
      { key: 'pixKey', label: 'Chave Pix', type: 'text' },
      { key: 'isDefaultReceiving', label: 'Padrão recebimento', type: 'bool' },
      { key: 'isDefaultPayment', label: 'Padrão pagamento', type: 'bool' },
    ],
  },
  fin_wallets: {
    path: 'financial.receivingWallets',
    title: 'Carteiras de Recebimento',
    desc: 'Onde o cliente paga (Pix, gateway, boleto, transferência).',
    cols: [['name', 'Carteira'], ['type', 'Tipo'], ['currency', 'Moeda'], ['_default', 'Padrão']],
    fields: [
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'type', label: 'Tipo', type: 'select', options: ['bank_account', 'pix', 'card_gateway', 'boleto', 'cash', 'international_transfer', 'wallet', 'payment_link'] },
      { key: 'linkedBankAccountId', label: 'Conta vinculada', type: 'select', optionsSource: 'financial.bankAccounts' },
      { key: 'currency', label: 'Moeda', type: 'select', options: ['BRL', 'EUR', 'USD'] },
      { key: 'settlementDays', label: 'Dias p/ liquidação', type: 'number' },
      { key: 'isDefault', label: 'Padrão', type: 'bool' },
    ],
  },
  fin_coa: {
    path: 'financial.chartOfAccounts',
    title: 'Plano de Contas',
    desc: 'Estrutura contábil para classificar lançamentos.',
    cols: [['code', 'Código'], ['name', 'Conta'], ['type', 'Tipo'], ['nature', 'Natureza']],
    fields: [
      { key: 'code', label: 'Código', type: 'text', required: true },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'type', label: 'Tipo', type: 'select', options: ['asset', 'liability', 'revenue', 'expense', 'cost', 'tax', 'transfer', 'equity'] },
      { key: 'nature', label: 'Natureza', type: 'select', options: ['debit', 'credit'] },
    ],
  },
  fin_cats: {
    path: 'financial.financialCategories',
    title: 'Categorias Financeiras',
    desc: 'Categorias de receita e despesa.',
    cols: [['code', 'Código'], ['name', 'Nome'], ['type', 'Tipo']],
    fields: [
      { key: 'code', label: 'Código', type: 'text' },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'type', label: 'Tipo', type: 'select', options: ['revenue', 'cost', 'expense', 'tax', 'transfer'] },
      { key: 'color', label: 'Cor', type: 'text' },
    ],
  },
  fin_cc: {
    path: 'financial.costCenters',
    title: 'Centros de Custo',
    desc: 'Centros de custo da empresa.',
    cols: [['code', 'Código'], ['name', 'Nome']],
    fields: [
      { key: 'code', label: 'Código', type: 'text' },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'managerUserId', label: 'Responsável', type: 'select', optionsSource: 'access.users' },
    ],
  },
  fin_taxes: {
    path: 'financial.taxes',
    title: 'Impostos',
    desc: 'ISS, IRPJ, retenções e tributos.',
    cols: [['code', 'Código'], ['name', 'Nome'], ['taxType', 'Tipo'], ['_pct', '%']],
    fields: [
      { key: 'code', label: 'Código', type: 'text' },
      { key: 'name', label: 'Nome', type: 'text', required: true },
      { key: 'taxType', label: 'Tipo', type: 'select', options: ['municipal', 'federal', 'state', 'international', 'service_tax', 'withholding', 'other'] },
      { key: 'calculationMode', label: 'Cálculo', type: 'select', options: ['percentage', 'fixed'] },
      { key: 'percent', label: '%', type: 'number' },
      { key: 'fixedAmount', label: 'Valor fixo', type: 'number' },
      { key: 'appliesTo', label: 'Aplica a', type: 'select', options: ['revenue', 'cost', 'service'] },
    ],
  },

  // ---------- SEGURANÇA E AUDITORIA ----------
  acc_departments: {
    path: 'access.departments',
    title: 'Departamentos',
    desc: 'Departamentos da empresa.',
    cols: [['code', 'Código'], ['name', 'Nome']],
    fields: [
      { key: 'code', label: 'Código', type: 'text' },
      { key: 'name', label: 'Nome', type: 'text', required: true },
    ],
  },

  // ---------- SAÚDE DO SISTEMA ----------
  op_country_catalog: {
    path: 'operational.countryCatalog',
    title: 'Catálogo Técnico de Países',
    desc: 'Catálogo técnico de apoio: país, rótulo pátrio, bandeira, idioma e moeda padrão. Não cria processo operacional.',
    technicalOnly: true,
    cols: [['flag', '🏳'], ['countryLabel', 'País'], ['nationalityLabel', 'Rótulo Pátrio'], ['defaultCurrency', 'Moeda']],
    fields: [
      { key: 'countryKey', label: 'Chave do País', type: 'text', required: true },
      { key: 'countryLabel', label: 'País', type: 'text', required: true },
      { key: 'nationalityKey', label: 'Chave Pátria', type: 'text', required: true },
      { key: 'nationalityLabel', label: 'Rótulo Pátrio', type: 'text', required: true },
      { key: 'flag', label: 'Bandeira', type: 'text' },
      { key: 'language', label: 'Idioma', type: 'text' },
      { key: 'defaultCurrency', label: 'Moeda Padrão', type: 'select', options: ['EUR', 'BRL', 'USD'] },
      { key: 'active', label: 'Ativo', type: 'boolean' },
    ],
  },
}