// lib/financeiro/leitura/extrato-ledger.ts
// ============================================================================
// EXTRATO = PROJEÇÃO PURA DO LEDGER (Etapa 2). Lista os MOVIMENTOS reais do razão
// (LedgerEntry, agrupados por transação) de um processo, em ordem cronológica,
// com saldo acumulado POR OBRIGAÇÃO (semântica não-ambígua; nunca soma direções
// distintas). `valorContabil` já é BRL — NÃO recomputa câmbio, NÃO usa
// valorContratado, NÃO usa fonte legada. Cada movimento traz tipo/natureza,
// conta, valor, referência da obrigação e a ocorrência de origem (rastreável a
// pagamento/estorno/desconto/encargo/contratação). Ver [[ledger-ssot-quatro-camadas]].
// ============================================================================
import { prisma } from '@/lib/prisma'
import { CONTA } from '../ledger/plano-contas'

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100

export interface MovimentoExtrato {
  transacaoId: string
  obrigacaoId: number
  codigo: string | null
  direcao: string            // A_RECEBER | A_PAGAR
  data: string
  tipo: string               // CONTRATACAO | PAGAMENTO | ESTORNO | DESCONTO | JUROS | MULTA | CREDITO | AJUSTE | ABERTURA
  descricao: string
  contaMovimento: string     // conta que caracteriza o movimento (código do plano)
  valorBrl: number           // valor do movimento (BRL, do razão)
  entradaSaida: 'ENTRADA' | 'SAIDA' | 'AJUSTE'  // impacto de CAIXA (entrada=recebeu, saida=pagou), ou ajuste sem caixa
  saldoObrigacaoApos: number // saldo remanescente da obrigação (a-receber/a-pagar) após este movimento
  ocorrenciaId: number | null
  moeda: string
}

// Deriva o tipo/descrição do movimento a partir das contas tocadas + tipo da ocorrência.
function classificar(contas: Set<string>, ocTipo: string | null): { tipo: string; descricao: string } {
  if (ocTipo === 'ESTORNO') return { tipo: 'ESTORNO', descricao: 'Estorno' }
  if (ocTipo === 'DESCONTO' || contas.has(CONTA.DESCONTOS)) return { tipo: 'DESCONTO', descricao: 'Desconto' }
  if (ocTipo === 'JUROS') return { tipo: 'JUROS', descricao: 'Juros' }
  if (ocTipo === 'MULTA') return { tipo: 'MULTA', descricao: 'Multa' }
  if (contas.has(CONTA.ENCARGOS)) return { tipo: 'JUROS', descricao: 'Encargo' }
  if (contas.has(CONTA.CREDITOS_CLIENTES)) return { tipo: 'CREDITO', descricao: 'Crédito' }
  if (contas.has(CONTA.CAIXA_BANCO)) return { tipo: 'PAGAMENTO', descricao: 'Pagamento' }
  if (contas.has(CONTA.SALDO_ABERTURA) || contas.has(CONTA.RECEITA_A_REALIZAR)) return { tipo: 'CONTRATACAO', descricao: 'Contratação' }
  return { tipo: 'AJUSTE', descricao: 'Ajuste' }
}

/** Extrato do processo = projeção cronológica dos movimentos do Ledger. */
export async function listarExtratoLedger(processoId: number): Promise<MovimentoExtrato[]> {
  const obrs = await prisma.obrigacaoEconomica.findMany({
    where: { processoId },
    select: { id: true, codigoOperacional: true, direcao: true, moedaContratual: true },
  })
  if (!obrs.length) return []
  const obrPor = new Map(obrs.map((o) => [o.id, o]))
  const ids = obrs.map((o) => o.id)
  const entries = await prisma.ledgerEntry.findMany({
    where: { obrigacaoId: { in: ids } },
    orderBy: [{ sequencia: 'asc' }],
    select: { obrigacaoId: true, ocorrenciaId: true, transacaoId: true, contaContabil: true, direcao: true, valorContabil: true, data: true, sequencia: true },
  })
  if (!entries.length) return []
  const ocIds = [...new Set(entries.map((e) => e.ocorrenciaId).filter((v): v is number => v != null))]
  const ocs = ocIds.length ? await prisma.ocorrenciaFinanceira.findMany({ where: { id: { in: ocIds } }, select: { id: true, tipo: true, observacao: true } }).catch(() => []) : []
  const ocPor = new Map(ocs.map((o) => [o.id, o]))

  // agrupa por transação (um movimento = uma transação), preservando ordem por sequência
  const grupos = new Map<string, typeof entries>()
  const ordem: string[] = []
  for (const e of entries) {
    const k = `${e.obrigacaoId}::${e.transacaoId}`
    if (!grupos.has(k)) { grupos.set(k, []); ordem.push(k) }
    grupos.get(k)!.push(e)
  }

  // saldo acumulado POR OBRIGAÇÃO: a-receber = Σdébitos−créditos em CLIENTES_A_RECEBER;
  // a-pagar = Σcréditos−débitos em FORNECEDORES_A_PAGAR (natureza credora).
  const saldoObr = new Map<number, number>()
  const out: MovimentoExtrato[] = []
  for (const k of ordem) {
    const pernas = grupos.get(k)!
    const obr = obrPor.get(pernas[0].obrigacaoId)!
    const contas = new Set(pernas.map((p) => p.contaContabil))
    const oc = pernas[0].ocorrenciaId != null ? ocPor.get(pernas[0].ocorrenciaId) : null
    const { tipo, descricao } = classificar(contas, oc?.tipo ?? null)
    const ehPagavel = obr.direcao === 'A_PAGAR'
    const contaObrig = ehPagavel ? CONTA.FORNECEDORES_A_PAGAR : CONTA.CLIENTES_A_RECEBER

    // atualiza saldo remanescente da obrigação (conta de natureza da direção)
    let deltaSaldo = 0
    for (const p of pernas) {
      if (p.contaContabil !== contaObrig) continue
      const v = Number(p.valorContabil)
      // a-receber (devedora): saldo += D − C. a-pagar (credora): saldo += C − D.
      deltaSaldo += ehPagavel ? (p.direcao === 'CREDITO' ? v : -v) : (p.direcao === 'DEBITO' ? v : -v)
    }
    const saldoAntes = saldoObr.get(obr.id) ?? 0
    const saldoDepois = cent(saldoAntes + deltaSaldo)
    saldoObr.set(obr.id, saldoDepois)

    // valor exibido do movimento + impacto de caixa
    const caixa = pernas.find((p) => p.contaContabil === CONTA.CAIXA_BANCO)
    let valorBrl: number
    let entradaSaida: MovimentoExtrato['entradaSaida']
    if (caixa) {
      valorBrl = cent(Number(caixa.valorContabil))
      entradaSaida = caixa.direcao === 'DEBITO' ? 'ENTRADA' : 'SAIDA'
    } else {
      // sem caixa: movimento sobre a obrigação (contratação/desconto/encargo/estorno sem caixa)
      valorBrl = cent(Math.abs(deltaSaldo) || Math.max(...pernas.map((p) => Number(p.valorContabil))))
      entradaSaida = 'AJUSTE'
    }
    const contaMovimento = caixa ? CONTA.CAIXA_BANCO : (pernas.find((p) => p.contaContabil !== contaObrig)?.contaContabil ?? contaObrig)

    out.push({
      transacaoId: pernas[0].transacaoId, obrigacaoId: obr.id, codigo: obr.codigoOperacional, direcao: obr.direcao,
      data: pernas[0].data.toISOString(), tipo, descricao: oc?.observacao ? `${descricao} · ${oc.observacao}`.slice(0, 200) : descricao,
      contaMovimento, valorBrl, entradaSaida, saldoObrigacaoApos: saldoDepois,
      ocorrenciaId: pernas[0].ocorrenciaId ?? null, moeda: String(obr.moedaContratual),
    })
  }
  // cronológico decrescente para exibição (mais recente primeiro)
  return out.reverse()
}
