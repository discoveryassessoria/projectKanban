// lib/operacional/torre-foco.ts
// ============================================================================
// FOCO DA FAMÍLIA — Bloco I3 (30/09/2026).
//
// Tudo é LEITURA das fontes que já existem — nenhum número recalculado, nada de exemplo:
//   • os 4 números e a tabela vêm das MESMAS linhas da aba Tarefas (`listarTarefasDaTorre`),
//     recortadas pelo processo — por isso batem com ela;
//   • "X de Y certidões recebidas" é o progresso real do Bloco E9 (`progressoRealDoProcesso`,
//     a mesma completude documental da Central);
//   • a LINHA DO TEMPO não é mais montada aqui: é o Histórico do processo (um registro por fato
//     real), o MESMO serviço da aba Histórico — `src/services/historico-processo.ts`, servido por
//     `/api/torre/foco/{id}/historico`. Duas linhas do tempo para a mesma família divergiriam.
// Comentários e "Relatório de controle" reaproveitam /api/comentarios e o motor de Relatórios.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { labelDaFasePorPhaseKey } from '@/src/lib/process-stage/fases-catalog'
import { listarTarefasDaTorre, type LinhaDaTorre } from '@/src/services/torre-tarefas'
import { progressoRealDoProcesso, diasNaFaseAtual } from './metricas-processo'
import { STATUS_DOCUMENTO_INATIVOS } from '@/src/lib/documentos/status-inativos'
import { encerramentosDosDocumentos } from '@/src/services/encerramento-documental'
import { TIPO_DOCUMENTO_LABELS } from '@/src/lib/process-stage/estrutura-operacional'
import type { EncerramentoDoDocumento } from '@/src/lib/process-stage/estrutura-operacional-core'

export interface FocoDaFamilia {
  processoId: number
  familiaId: number | null
  familiaNome: string
  pais: string | null
  codigo: string | null
  faseAtual: { key: string | null; label: string | null; dias: number | null; horas: number | null; desde: string | null; origem: string | null }
  certidoes: { recebidas: number; requeridas: number }
  numeros: { abertas: number; vencidas: number; comCartorio: number; semResponsavel: number }
  tarefas: LinhaDaTorre[]
  /**
   * CANCELAR NUNCA ESCONDE, SÓ MARCA: as certidões CANCELADAS ou NÃO EXIGIDAS não são trabalho (não entram em `tarefas` nem nos
   * 4 números), mas o Foco as MOSTRA, marcadas, com quem/quando/por quê. O Histórico (mesma tela) registra o fato.
   */
  encerradas: CertidaoEncerradaDoFoco[]
}

export interface CertidaoEncerradaDoFoco {
  documentoId: number
  titulo: string
  pessoa: string | null
  encerramento: EncerramentoDoDocumento | null
  tipo: 'CANCELADA' | 'NAO_EXIGIDA'
}

/** Os 4 números do Foco — a MESMA definição dos filtros da aba Tarefas (Vencidas / Com o cartório / Sem responsável). */
export function numerosDoFoco(linhas: Array<Pick<LinhaDaTorre, 'atrasada' | 'estadoOperacao' | 'responsavelId'>>) {
  return {
    abertas: linhas.length,
    vencidas: linhas.filter((l) => l.atrasada).length,
    comCartorio: linhas.filter((l) => l.estadoOperacao === 'AGUARDANDO').length,
    semResponsavel: linhas.filter((l) => l.responsavelId == null).length,
  }
}

export async function focoDaFamilia(processoId: number, agora = new Date()): Promise<FocoDaFamilia | null> {
  const proc = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, nome: true, codigo: true, faseAtualKey: true, familiaId: true, arvoreId: true, familia: { select: { nome: true } }, paisCanonico: { select: { countryLabel: true } } },
  })
  if (!proc) return null

  const [{ linhas }, progresso, dias] = await Promise.all([
    listarTarefasDaTorre({ processoId }, agora),
    progressoRealDoProcesso(processoId),
    diasNaFaseAtual(processoId, agora),
  ])
  const rot = (k: string | null) => (k ? labelDaFasePorPhaseKey(k) ?? k : '—')

  // As certidões fora do trabalho (canceladas / não exigidas) do processo: uma leitura em lote, pela mesma fonte da Central.
  const inativos = proc.arvoreId
    ? await prisma.documento.findMany({
        where: { pessoa: { arvoreId: proc.arvoreId }, status: { in: [...STATUS_DOCUMENTO_INATIVOS] } },
        select: { id: true, tipo: true, status: true, pessoa: { select: { nome: true, sobrenome: true } } },
        orderBy: { id: 'asc' },
      })
    : []
  const idsInativos = inativos.map((d) => d.id)
  const [encerramentos, tarefasDosInativos] = await Promise.all([
    encerramentosDosDocumentos(idsInativos),
    idsInativos.length ? prisma.tarefa.findMany({ where: { documentoId: { in: idsInativos } }, select: { documentoId: true, titulo: true }, orderBy: { id: 'desc' } }) : Promise.resolve([]),
  ])
  const tituloDoDoc = new Map<number, string>()
  for (const t of tarefasDosInativos) if (t.documentoId != null && !tituloDoDoc.has(t.documentoId)) tituloDoDoc.set(t.documentoId, t.titulo.split(' · ')[0].trim())
  const encerradas: CertidaoEncerradaDoFoco[] = inativos.map((d) => ({
    documentoId: d.id,
    titulo: tituloDoDoc.get(d.id) ?? (d.tipo ? TIPO_DOCUMENTO_LABELS[d.tipo] ?? String(d.tipo) : `Documento #${d.id}`),
    pessoa: d.pessoa ? [d.pessoa.nome, d.pessoa.sobrenome].filter(Boolean).join(' ') : null,
    encerramento: encerramentos.get(d.id) ?? null,
    tipo: String(d.status) === 'NAO_EXIGIDO' ? 'NAO_EXIGIDA' : 'CANCELADA',
  }))

  return {
    processoId, familiaId: proc.familiaId, familiaNome: proc.familia?.nome ?? proc.nome,
    pais: proc.paisCanonico?.countryLabel ?? null, codigo: proc.codigo,
    faseAtual: { key: proc.faseAtualKey, label: rot(proc.faseAtualKey), dias: dias.dias, horas: dias.horas, desde: dias.desde, origem: dias.origem },
    certidoes: { recebidas: progresso.completed, requeridas: progresso.required },
    numeros: numerosDoFoco(linhas), tarefas: linhas, encerradas,
  }
}
