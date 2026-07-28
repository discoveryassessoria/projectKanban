// lib/financeiro/leitura/contas-a-pagar.ts
// ============================================================================
// F5.1 — CONTAS A PAGAR operacional. Read-model ÚNICO sobre o Motor V3
// (listarObrigacoes → direção A_PAGAR): NÃO cria fonte nova, reusa a espinha do
// Ledger/projeção + o estado de negócio (estadoCusto) + câmbio/aging. Entrega os
// baldes operacionais e as agregações que a tela de Contas a Pagar consome.
// ============================================================================
import { listarObrigacoes, type ObrigacaoLista } from './consultas'

export interface FiltroContasAPagar { processoId?: number; fornecedor?: string; moeda?: string; origem?: string }

export interface ItemContaPagar extends ObrigacaoLista {
  diasAtraso: number
  balde: 'VENCIDA' | 'HOJE' | 'PROXIMA' | 'PARCIAL' | 'PAGA' | 'CANCELADA' | 'FUTURA'
}

const DIA = 86_400_000
function diasAte(venc: string | null): number | null {
  if (!venc) return null
  return Math.ceil((new Date(venc).getTime() - Date.now()) / DIA)
}

function balde(o: ObrigacaoLista): ItemContaPagar['balde'] {
  const est = o.estadoCusto
  if (est === 'CANCELADO' || o.status === 'CANCELADO') return 'CANCELADA'
  const pago = Number(o.saldo) <= 0.005
  if (pago || est === 'PAGO' || est === 'CONCILIADO') return 'PAGA'
  const d = diasAte(o.vencimento)
  if (Number(o.recebido) > 0.005) return 'PARCIAL' // parcialmente paga (ainda com saldo)
  if (d == null) return 'FUTURA'
  if (d < 0) return 'VENCIDA'
  if (d === 0) return 'HOJE'
  if (d <= 7) return 'PROXIMA'
  return 'FUTURA'
}

export async function listarContasAPagar(f?: FiltroContasAPagar) {
  // A_PAGAR = custos/reembolsos do V3 (exclui CANCELADO/arquivado no read-model base).
  const base = await listarObrigacoes({ processoId: f?.processoId })
  let pagaveis = base.filter((o) => o.direcao === 'A_PAGAR')
  if (f?.fornecedor) pagaveis = pagaveis.filter((o) => (o.fornecedor ?? '').toLowerCase().includes(f.fornecedor!.toLowerCase()))
  if (f?.moeda) pagaveis = pagaveis.filter((o) => o.moeda === f.moeda)
  if (f?.origem) pagaveis = pagaveis.filter((o) => (o.origemTipo ?? 'nativo') === f.origem)

  const itens: ItemContaPagar[] = pagaveis.map((o) => {
    const d = diasAte(o.vencimento)
    return { ...o, diasAtraso: d != null && d < 0 ? -d : 0, balde: balde(o) }
  })

  const somaBrl = (arr: ItemContaPagar[]) => Math.round(arr.reduce((s, o) => s + Number(o.saldoBrl ?? 0), 0) * 100) / 100
  const porBalde = (b: ItemContaPagar['balde']) => itens.filter((o) => o.balde === b)
  const baldes = {
    vencidas: { qtd: porBalde('VENCIDA').length, totalBrl: somaBrl(porBalde('VENCIDA')) },
    hoje: { qtd: porBalde('HOJE').length, totalBrl: somaBrl(porBalde('HOJE')) },
    proximas: { qtd: porBalde('PROXIMA').length, totalBrl: somaBrl(porBalde('PROXIMA')) },
    parciais: { qtd: porBalde('PARCIAL').length, totalBrl: somaBrl(porBalde('PARCIAL')) },
    pagas: { qtd: porBalde('PAGA').length, totalBrl: somaBrl(porBalde('PAGA')) },
    canceladas: { qtd: porBalde('CANCELADA').length, totalBrl: somaBrl(porBalde('CANCELADA')) },
    futuras: { qtd: porBalde('FUTURA').length, totalBrl: somaBrl(porBalde('FUTURA')) },
  }

  const agrupar = (chave: (o: ItemContaPagar) => string) => {
    const m = new Map<string, { qtd: number; saldoBrl: number }>()
    for (const o of itens) { const k = chave(o); const cur = m.get(k) ?? { qtd: 0, saldoBrl: 0 }; cur.qtd++; cur.saldoBrl += Number(o.saldoBrl ?? 0); m.set(k, cur) }
    return [...m.entries()].map(([nome, v]) => ({ nome, qtd: v.qtd, saldoBrl: Math.round(v.saldoBrl * 100) / 100 })).sort((a, b) => b.saldoBrl - a.saldoBrl)
  }

  const abertas = itens.filter((o) => o.balde !== 'PAGA' && o.balde !== 'CANCELADA')
  return {
    itens,
    baldes,
    porFornecedor: agrupar((o) => o.fornecedor ?? '—'),
    porResponsavel: agrupar((o) => o.responsavel ?? '—'),
    porMoeda: agrupar((o) => o.moeda),
    porOrigem: agrupar((o) => o.origemTipo ?? 'nativo'),
    kpis: {
      aPagarBrl: somaBrl(abertas),
      qtdAbertas: abertas.length,
      vencidoBrl: baldes.vencidas.totalBrl,
      qtdVencidas: baldes.vencidas.qtd,
      total: itens.length,
    },
  }
}
