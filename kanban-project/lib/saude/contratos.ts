// lib/saude/contratos.ts
//
// CONTRATOS DE PRONTIDÃO POR CADASTRO.
//
// Um cadastro ATIVO promete estar utilizável. Este arquivo declara o que cada
// tipo de cadastro precisa ter para cumprir essa promessa — e a avaliação
// devolve exatamente QUEM está incompleto, não só quantos.
//
// A regra é conservadora de propósito: só entra aqui requisito que impede uso
// real. Preferência estética não vira achado.

import { prisma } from '@/lib/prisma'

export interface ItemIncompleto {
  id: number
  rotulo: string
  /** quais requisitos do contrato este registro não cumpre */
  faltando: string[]
}

export interface ResultadoContrato {
  cadastro: string
  rotulo: string
  rota: string
  totalAtivos: number
  incompletos: ItemIncompleto[]
  /** requisitos declarados, para a tela explicar o contrato */
  requisitos: string[]
}

/** SERVIÇO/ITEM ATIVO — o que precisa para ser vendável e operável. */
export async function contratoServico(): Promise<ResultadoContrato> {
  const itens = await prisma.itemCatalogo.findMany({
    where: { ativo: true },
    select: {
      id: true, name: true, code: true, natureza: true, categoriaId: true,
      produtos: {
        where: { ativo: true },
        select: { id: true, naturezaFin: true, possuiCusto: true, possuiReceita: true, moedaPadrao: true },
      },
      precos: { where: { arquivado: false, legadoPendente: false }, select: { natureza: true, moeda: true } },
    },
  })

  const incompletos: ItemIncompleto[] = []
  for (const i of itens) {
    const faltando: string[] = []
    if (!i.code?.trim()) faltando.push('código')
    if (!i.name?.trim()) faltando.push('nome')
    if (!i.natureza) faltando.push('natureza do item')
    const cfg = i.produtos[0]
    if (!cfg) faltando.push('configuração financeira')
    else {
      const geraReceita = cfg.naturezaFin ? cfg.naturezaFin !== 'SOMENTE_CUSTO' : cfg.possuiReceita
      const naturezas = new Set(i.precos.map((p) => String(p.natureza)))
      if (!cfg.naturezaFin && !cfg.possuiCusto && !cfg.possuiReceita) faltando.push('natureza financeira')
      if (geraReceita && !naturezas.has('VENDA') && !naturezas.has('RECEITA')) faltando.push('preço de venda vigente')
      if (!cfg.moedaPadrao) faltando.push('moeda padrão')
    }
    if (faltando.length) incompletos.push({ id: i.id, rotulo: i.name, faltando })
  }

  return {
    cadastro: 'ItemCatalogo',
    rotulo: 'Serviços e itens do Catálogo Mestre',
    rota: '/administrator?screen=products',
    totalAtivos: itens.length,
    incompletos,
    requisitos: ['código', 'nome', 'natureza do item', 'configuração financeira', 'natureza financeira', 'preço de venda vigente quando gera receita', 'moeda padrão'],
  }
}

/** TIPO DE PROCESSO ATIVO — o que precisa para nascer processo em cima dele. */
export async function contratoTipoProcesso(): Promise<ResultadoContrato> {
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({
    where: { ativo: true, arquivado: false },
    select: {
      id: true, name: true, code: true,
      macroWorkflow: { select: { ativo: true, fases: { select: { phaseKey: true, ordem: true, required: true } } } },
    },
  })
  const chavesCatalogo = new Set(
    (await prisma.catalogoFase.findMany({ where: { ativo: true }, select: { phaseKey: true } })).map((c) => c.phaseKey),
  )

  const incompletos: ItemIncompleto[] = []
  for (const t of tipos) {
    const faltando: string[] = []
    if (!t.code?.trim()) faltando.push('código')
    const wf = t.macroWorkflow
    if (!wf) faltando.push('workflow macro')
    else {
      if (!wf.ativo) faltando.push('workflow ativo')
      if (!wf.fases.length) faltando.push('fases do workflow')
      else {
        const ordenadas = [...wf.fases].sort((a, b) => a.ordem - b.ordem)
        if (ordenadas.length < 2) faltando.push('fase final (o fluxo precisa de início e fim)')
        if (!ordenadas.some((f) => f.required)) faltando.push('ao menos uma fase obrigatória')
        const foraDoCatalogo = ordenadas.filter((f) => !chavesCatalogo.has(f.phaseKey))
        if (foraDoCatalogo.length) faltando.push(`fases fora do catálogo (${foraDoCatalogo.map((f) => f.phaseKey).join(', ')})`)
      }
    }
    if (faltando.length) incompletos.push({ id: t.id, rotulo: t.name, faltando })
  }

  return {
    cadastro: 'TipoProcessoNacionalidade',
    rotulo: 'Tipos de Processo',
    rota: '/administrator?screen=proctypes',
    totalAtivos: tipos.length,
    incompletos,
    requisitos: ['código', 'workflow macro ativo', 'fases declaradas', 'fase inicial e final', 'ao menos uma fase obrigatória', 'fases existentes no catálogo'],
  }
}

/** DOCUMENTO MESTRE ATIVO. */
export async function contratoTipoDocumento(): Promise<ResultadoContrato> {
  const tipos = await prisma.tipoDocumentoCadastro.findMany({
    where: { ativo: true },
    select: { id: true, name: true, code: true, publicCode: true, categoriaDocumentalId: true, category: true },
  })
  const incompletos: ItemIncompleto[] = []
  for (const t of tipos) {
    const faltando: string[] = []
    if (!t.publicCode) faltando.push('código público')
    if (!t.code?.trim()) faltando.push('chave técnica')
    if (!t.categoriaDocumentalId && !t.category) faltando.push('categoria documental')
    if (faltando.length) incompletos.push({ id: t.id, rotulo: t.name, faltando })
  }
  return {
    cadastro: 'TipoDocumentoCadastro',
    rotulo: 'Tipos de Documento',
    rota: '/administrator?screen=doctypes',
    totalAtivos: tipos.length,
    incompletos,
    requisitos: ['código público', 'chave técnica', 'categoria documental'],
  }
}

/** ORGANIZAÇÃO ATIVA. */
export async function contratoOrganizacao(): Promise<ResultadoContrato> {
  const orgs = await prisma.orgaoProtocolo.findMany({
    where: { ativo: true },
    select: {
      id: true, name: true, publicCode: true, country: true, funcoes: true,
      categorias: { select: { categoriaId: true } },
    },
  })
  const incompletos: ItemIncompleto[] = []
  for (const o of orgs) {
    const faltando: string[] = []
    if (!o.publicCode) faltando.push('código público')
    if (!o.country?.trim()) faltando.push('país')
    if (!o.funcoes.length) faltando.push('função')
    if (!o.categorias.length) faltando.push('categoria')
    if (faltando.length) incompletos.push({ id: o.id, rotulo: o.name, faltando })
  }
  return {
    cadastro: 'OrgaoProtocolo',
    rotulo: 'Órgãos e Organizações',
    rota: '/administrator?screen=organs',
    totalAtivos: orgs.length,
    incompletos,
    requisitos: ['código público', 'nome oficial', 'país', 'ao menos uma função', 'ao menos uma categoria'],
  }
}

/** FORNECEDOR ATIVO — organização com a função FORNECEDOR. */
export async function contratoFornecedor(): Promise<ResultadoContrato> {
  const forns = await prisma.orgaoProtocolo.findMany({
    where: { ativo: true, funcoes: { has: 'FORNECEDOR' } },
    select: { id: true, name: true, publicCode: true, moeda: true, identificacaoFiscal: true, country: true },
  })
  const incompletos: ItemIncompleto[] = []
  for (const f of forns) {
    const faltando: string[] = []
    if (!f.publicCode) faltando.push('código público')
    if (!f.country?.trim()) faltando.push('país')
    // Moeda e identificação fiscal só são exigidas de quem é efetivamente pago —
    // o que não dá para inferir daqui. Ficam como recomendação, não bloqueio.
    if (faltando.length) incompletos.push({ id: f.id, rotulo: f.name, faltando })
  }
  return {
    cadastro: 'OrgaoProtocolo (função Fornecedor)',
    rotulo: 'Fornecedores',
    rota: '/administrator?screen=organs',
    totalAtivos: forns.length,
    incompletos,
    requisitos: ['código público', 'país', 'função Fornecedor'],
  }
}

/** CONFIGURAÇÃO FINANCEIRA ATIVA. */
export async function contratoConfigFinanceira(): Promise<ResultadoContrato> {
  const configs = await prisma.produtoFinanceiro.findMany({
    where: { ativo: true },
    select: {
      id: true, nome: true, naturezaFin: true, possuiCusto: true, possuiReceita: true,
      moedaPadrao: true, itemCatalogoId: true,
      precosConfig: { where: { arquivado: false, legadoPendente: false }, select: { natureza: true } },
    },
  })
  const incompletos: ItemIncompleto[] = []
  for (const c of configs) {
    const faltando: string[] = []
    if (!c.naturezaFin && !c.possuiCusto && !c.possuiReceita) faltando.push('natureza financeira')
    if (!c.itemCatalogoId) faltando.push('vínculo com item do Catálogo Mestre')
    if (!c.moedaPadrao) faltando.push('moeda padrão')
    const geraReceita = c.naturezaFin ? c.naturezaFin !== 'SOMENTE_CUSTO' : c.possuiReceita
    const naturezas = new Set(c.precosConfig.map((p) => String(p.natureza)))
    if (geraReceita && !naturezas.has('VENDA') && !naturezas.has('RECEITA')) faltando.push('preço de venda vigente')
    if (faltando.length) incompletos.push({ id: c.id, rotulo: c.nome, faltando })
  }
  return {
    cadastro: 'ProdutoFinanceiro',
    rotulo: 'Configurações Financeiras',
    rota: '/administrator?screen=catalog',
    totalAtivos: configs.length,
    incompletos,
    requisitos: ['natureza financeira', 'vínculo com item do Catálogo Mestre', 'moeda padrão', 'preço vigente quando gera receita'],
  }
}

/** Todos os contratos, avaliados. */
export async function avaliarContratos(): Promise<ResultadoContrato[]> {
  return Promise.all([
    contratoServico(),
    contratoTipoProcesso(),
    contratoTipoDocumento(),
    contratoOrganizacao(),
    contratoFornecedor(),
    contratoConfigFinanceira(),
  ])
}
