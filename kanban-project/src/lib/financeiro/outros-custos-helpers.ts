// src/lib/financeiro/outros-custos-helpers.ts
//
// 🆕 LOTE 5: Helpers de cálculo para OutrosCustos.
//
// Funções puras que recebem dados de OutroCusto e retornam totais,
// status visuais, conversões de moeda, etc. Usadas pelos componentes
// de UI sem precisar repetir lógica.

import type {
  OutroCustoData,
  PagamentoOutroCustoData,
} from '@/src/types/outros-custos'

// ============================================================================
// Conversão de moeda
// ============================================================================

/**
 * Converte um valor em moeda estrangeira para BRL usando o câmbio.
 * Se a moeda já for BRL, retorna o valor original.
 */
export function valorEmBRL(oc: OutroCustoData): number {
  const valor = Number(oc.valor)
  if (oc.moeda === 'BRL') return valor
  const cambio = Number(oc.cambio || 1)
  return valor * cambio
}

/**
 * Converte o valor de um pagamento para BRL usando o câmbio do OutroCusto pai.
 * (Pagamentos não armazenam câmbio próprio.)
 */
export function pagamentoEmBRL(
  pagamento: PagamentoOutroCustoData,
  oc: OutroCustoData,
): number {
  const valor = Number(pagamento.valor)
  if (oc.moeda === 'BRL') return valor
  const cambio = Number(oc.cambio || 1)
  return valor * cambio
}

// ============================================================================
// Cálculos por OutroCusto
// ============================================================================

/**
 * Soma todos os pagamentos NÃO ESTORNADOS de um OutroCusto, em BRL.
 */
export function totalPagoBRL(oc: OutroCustoData): number {
  if (!oc.pagamentos) return 0
  return oc.pagamentos
    .filter((p) => !p.estornado)
    .reduce((s, p) => s + pagamentoEmBRL(p, oc), 0)
}

/**
 * Soma pagamentos não estornados na moeda original (sem conversão).
 */
export function totalPagoOriginal(oc: OutroCustoData): number {
  if (!oc.pagamentos) return 0
  return oc.pagamentos
    .filter((p) => !p.estornado)
    .reduce((s, p) => s + Number(p.valor), 0)
}

/**
 * Quanto ainda falta pagar (em BRL).
 */
export function restanteBRL(oc: OutroCustoData): number {
  return Math.max(0, valorEmBRL(oc) - totalPagoBRL(oc))
}

/**
 * Quanto ainda falta pagar (na moeda original).
 */
export function restanteOriginal(oc: OutroCustoData): number {
  return Math.max(0, Number(oc.valor) - totalPagoOriginal(oc))
}

/**
 * Percentual pago (0-100).
 */
export function percentualPago(oc: OutroCustoData): number {
  const total = Number(oc.valor)
  if (total <= 0) return 0
  const pago = totalPagoOriginal(oc)
  return Math.min(100, (pago / total) * 100)
}

// ============================================================================
// Status visual de um OutroCusto
// ============================================================================

export type StatusOutroCusto =
  | 'pago' // 100% pago
  | 'parcial' // > 0 e < 100%
  | 'pendente' // 0% pago, sem vencimento ou vencimento futuro
  | 'vencido' // 0% pago, vencimento passado
  | 'vencido_parcial' // pagamento parcial mas vencido

/**
 * Retorna o status visual de um OutroCusto baseado em pagamentos + vencimento.
 */
export function statusOutroCusto(oc: OutroCustoData): StatusOutroCusto {
  const total = Number(oc.valor)
  const pago = totalPagoOriginal(oc)

  // Totalmente pago (com tolerância pra arredondamento)
  if (pago >= total - 0.005) return 'pago'

  // Tem vencimento e já passou?
  let vencido = false
  if (oc.vencimento) {
    const dataVenc = new Date(oc.vencimento)
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    vencido = dataVenc.getTime() < hoje.getTime()
  }

  if (pago > 0) return vencido ? 'vencido_parcial' : 'parcial'
  return vencido ? 'vencido' : 'pendente'
}

/**
 * Quantos dias o OutroCusto está em atraso (0 se não vencido).
 */
export function diasEmAtraso(oc: OutroCustoData): number {
  if (!oc.vencimento) return 0
  const dataVenc = new Date(oc.vencimento)
  dataVenc.setHours(0, 0, 0, 0)
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const diff = hoje.getTime() - dataVenc.getTime()
  if (diff <= 0) return 0
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

// ============================================================================
// Filtros
// ============================================================================

export function filtrarPorNatureza(
  lista: OutroCustoData[],
  natureza: 'COBRAR' | 'REPASSAR',
): OutroCustoData[] {
  return lista.filter((oc) => oc.natureza === natureza)
}

export function filtrarPorTipo(
  lista: OutroCustoData[],
  tipo: string,
): OutroCustoData[] {
  if (!tipo || tipo === 'todos') return lista
  return lista.filter((oc) => oc.tipo === tipo)
}

export function filtrarPorBusca(
  lista: OutroCustoData[],
  busca: string,
): OutroCustoData[] {
  if (!busca.trim()) return lista
  const q = busca.toLowerCase().trim()
  return lista.filter(
    (oc) =>
      oc.descricao.toLowerCase().includes(q) ||
      oc.tipo.toLowerCase().includes(q) ||
      (oc.fornecedor || '').toLowerCase().includes(q) ||
      (oc.observacao || '').toLowerCase().includes(q),
  )
}

// ============================================================================
// Ordenação
// ============================================================================

export type OrdemOutroCusto = 'vencimento' | 'valor' | 'criacao'

export function ordenarOutrosCustos(
  lista: OutroCustoData[],
  ordem: OrdemOutroCusto,
): OutroCustoData[] {
  const copia = [...lista]

  switch (ordem) {
    case 'valor':
      return copia.sort((a, b) => valorEmBRL(b) - valorEmBRL(a))

    case 'vencimento':
      return copia.sort((a, b) => {
        const va = a.vencimento || '9999-12-31'
        const vb = b.vencimento || '9999-12-31'
        return va.localeCompare(vb)
      })

    case 'criacao':
      return copia.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    default:
      return copia
  }
}

// ============================================================================
// Agrupamento por tipo (pra gerar breakdown)
// ============================================================================

export interface AgrupamentoPorTipo {
  tipo: string
  total: number // em BRL
  contagem: number
  itens: OutroCustoData[]
}

export function agruparPorTipo(
  lista: OutroCustoData[],
): AgrupamentoPorTipo[] {
  const mapa = new Map<string, AgrupamentoPorTipo>()

  for (const oc of lista) {
    if (!mapa.has(oc.tipo)) {
      mapa.set(oc.tipo, { tipo: oc.tipo, total: 0, contagem: 0, itens: [] })
    }
    const grupo = mapa.get(oc.tipo)!
    grupo.total += valorEmBRL(oc)
    grupo.contagem++
    grupo.itens.push(oc)
  }

  // Retorna ordenado por total decrescente
  return Array.from(mapa.values()).sort((a, b) => b.total - a.total)
}

// ============================================================================
// Validação de form
// ============================================================================

export interface ErrosFormOutroCusto {
  natureza?: string
  tipo?: string
  descricao?: string
  valor?: string
  moeda?: string
  cambio?: string
}

/**
 * Valida o formulário antes de submeter. Retorna objeto com erros (vazio se OK).
 */
export function validarFormOutroCusto(form: {
  natureza?: string
  tipo?: string
  descricao?: string
  valor?: number | string
  moeda?: string
  cambio?: number | string
}): ErrosFormOutroCusto {
  const erros: ErrosFormOutroCusto = {}

  if (!form.natureza || !['COBRAR', 'REPASSAR'].includes(form.natureza)) {
    erros.natureza = 'Selecione se é cobrança ou repasse'
  }

  if (!form.tipo || !String(form.tipo).trim()) {
    erros.tipo = 'Selecione um tipo'
  }

  if (!form.descricao || !String(form.descricao).trim()) {
    erros.descricao = 'Descrição é obrigatória'
  }

  const valor = Number(form.valor)
  if (isNaN(valor) || valor <= 0) {
    erros.valor = 'Valor deve ser maior que zero'
  }

  if (!form.moeda || !['BRL', 'EUR', 'USD'].includes(form.moeda)) {
    erros.moeda = 'Selecione uma moeda'
  }

  if (form.moeda && form.moeda !== 'BRL') {
    const cambio = Number(form.cambio)
    if (isNaN(cambio) || cambio <= 0) {
      erros.cambio = 'Câmbio é obrigatório para moeda estrangeira'
    }
  }

  return erros
}