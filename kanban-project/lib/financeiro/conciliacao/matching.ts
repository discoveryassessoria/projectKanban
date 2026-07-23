// lib/financeiro/conciliacao/matching.ts
// ============================================================================
// CONCILIAÇÃO BANCÁRIA — matching PURO (Motor Financeiro V3 · Fase 3).
// Casa linhas de extrato bancário com ocorrências de PAGAMENTO do Ledger.
// Critério: identificador de transação (forte) OU valor líquido ≈ com data
// próxima. Divergências NUNCA são resolvidas em silêncio — viram DIVERGENTE.
// Ver spec §Conciliação (estados INFORMADO→CONCILIADO|DIVERGENTE).
// ============================================================================

const cent = (v: number) => Math.round((Number(v) || 0) * 100) / 100
const dias = (a: Date | string, b: Date | string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000

export interface LinhaExtrato {
  id: number
  data: Date | string
  valorLiquido: number
  identificadorTransacao?: string | null
}
export interface OcorrenciaConciliavel {
  ocorrenciaId: number
  obrigacaoId: number
  data: Date | string
  valor: number // valor da ocorrência de pagamento
  identificadorTransacao?: string | null
  jaConciliada?: boolean
}

export type ResultadoLinha =
  | { linhaId: number; status: 'CONCILIADO'; ocorrenciaId: number; obrigacaoId: number; criterio: 'IDENTIFICADOR' | 'VALOR_DATA' }
  | { linhaId: number; status: 'DIVERGENTE'; divergencia: string; candidatoOcorrenciaId?: number }
  | { linhaId: number; status: 'SEM_CORRESPONDENCIA'; divergencia: string }

export interface ResultadoConciliacao {
  linhas: ResultadoLinha[]
  conciliadas: number
  divergentes: number
  semCorrespondencia: number
}

/**
 * Concilia `linhas` contra `ocorrencias` (puro, determinístico). Cada ocorrência
 * casa no máximo uma linha. Tolerância de data configurável (default 3 dias).
 */
export function conciliar(
  linhas: LinhaExtrato[],
  ocorrencias: OcorrenciaConciliavel[],
  opts?: { toleranciaDias?: number },
): ResultadoConciliacao {
  const tol = opts?.toleranciaDias ?? 3
  const disponiveis = ocorrencias.filter((o) => !o.jaConciliada)
  const usadas = new Set<number>()
  const linhasOut: ResultadoLinha[] = []

  // ordem determinística: por id de linha
  for (const l of [...linhas].sort((a, b) => a.id - b.id)) {
    const vl = cent(l.valorLiquido)

    // 1) match forte por identificador de transação
    if (l.identificadorTransacao) {
      const porId = disponiveis.find((o) => !usadas.has(o.ocorrenciaId) && o.identificadorTransacao && o.identificadorTransacao === l.identificadorTransacao)
      if (porId) {
        if (Math.abs(cent(porId.valor) - vl) > 0.005) {
          linhasOut.push({ linhaId: l.id, status: 'DIVERGENTE', divergencia: `identificador confere mas valor difere (extrato ${vl} × ocorrência ${cent(porId.valor)})`, candidatoOcorrenciaId: porId.ocorrenciaId })
          continue
        }
        usadas.add(porId.ocorrenciaId)
        linhasOut.push({ linhaId: l.id, status: 'CONCILIADO', ocorrenciaId: porId.ocorrenciaId, obrigacaoId: porId.obrigacaoId, criterio: 'IDENTIFICADOR' })
        continue
      }
    }

    // 2) match por valor líquido + data próxima
    const candidatos = disponiveis.filter((o) => !usadas.has(o.ocorrenciaId) && Math.abs(cent(o.valor) - vl) <= 0.005)
    const porData = candidatos.filter((o) => dias(o.data, l.data) <= tol).sort((a, b) => dias(a.data, l.data) - dias(b.data, l.data))
    if (porData.length === 1 || (porData.length > 1 && dias(porData[0].data, l.data) < dias(porData[1].data, l.data))) {
      const m = porData[0]
      usadas.add(m.ocorrenciaId)
      linhasOut.push({ linhaId: l.id, status: 'CONCILIADO', ocorrenciaId: m.ocorrenciaId, obrigacaoId: m.obrigacaoId, criterio: 'VALOR_DATA' })
      continue
    }
    if (porData.length > 1) {
      linhasOut.push({ linhaId: l.id, status: 'DIVERGENTE', divergencia: `valor casa com ${porData.length} ocorrências na mesma data — ambíguo, resolver manualmente`, candidatoOcorrenciaId: porData[0].ocorrenciaId })
      continue
    }
    if (candidatos.length > 0) {
      linhasOut.push({ linhaId: l.id, status: 'DIVERGENTE', divergencia: `valor casa mas fora da tolerância de ${tol} dias`, candidatoOcorrenciaId: candidatos[0].ocorrenciaId })
      continue
    }
    linhasOut.push({ linhaId: l.id, status: 'SEM_CORRESPONDENCIA', divergencia: `nenhuma ocorrência com valor líquido ${vl}` })
  }

  return {
    linhas: linhasOut,
    conciliadas: linhasOut.filter((x) => x.status === 'CONCILIADO').length,
    divergentes: linhasOut.filter((x) => x.status === 'DIVERGENTE').length,
    semCorrespondencia: linhasOut.filter((x) => x.status === 'SEM_CORRESPONDENCIA').length,
  }
}
