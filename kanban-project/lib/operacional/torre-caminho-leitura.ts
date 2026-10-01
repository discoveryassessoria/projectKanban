// lib/operacional/torre-caminho-leitura.ts
// O LEITOR DO CAMINHO DO PROCESSO (servidor) — carrega do banco o que `torre-caminho.ts` (puro) precisa, em poucas consultas
// constantes no volume. Ver o cabeçalho de `torre-caminho.ts` para as fontes e a divergência registrada (D02).
import { prisma } from '@/lib/prisma'
import { labelDaFasePorPhaseKey } from '@/src/lib/process-stage/fases-catalog'
import { proximaFaseDoCaminho } from '@/src/lib/motor/phase-advance-helpers'
import { RESULTADOS_QUE_MOVEM_DE_FASE } from './metricas-processo'
import { montarCaminho, passagensPelasFases, type FaseCadastrada, type FaseDoCaminho, type TarefasDaFase } from './torre-caminho'

const STATUS_FORA_DA_CONTA = ['CANCELADA', 'SUPERSEDIDA', 'DISPENSADA']
const STATUS_CONCLUIDOS = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI']

export interface CaminhoDoProcesso { fases: FaseDoCaminho[]; numeroDaFaseAtual: number | null; total: number; proximaFaseLabel: string | null }

/** Lê do banco tudo o que o caminho precisa, em poucas consultas (constantes no volume). */
export async function lerCaminhoDoProcesso(processoId: number): Promise<CaminhoDoProcesso | null> {
  const proc = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, faseAtualKey: true, tipoProcessoMotorId: true, modalidadeId: true, dataInicio: true, createdAt: true },
  })
  if (!proc) return null

  const [fasesDb, analise, logs, instancias, tarefas] = await Promise.all([
    proc.tipoProcessoMotorId != null
      ? prisma.faseMacro.findMany({
          where: { macroWorkflow: { tipoProcessoId: proc.tipoProcessoMotorId, ...(proc.modalidadeId != null ? { modalidadeId: proc.modalidadeId } : {}) } },
          orderBy: { ordem: 'asc' }, select: { phaseKey: true, ordem: true, label: true, conditional: true, required: true },
        })
      : Promise.resolve([]),
    prisma.analiseDocumental.findFirst({ where: { processoId }, orderBy: { id: 'desc' }, select: { requerRetificacao: true } }),
    prisma.phaseAdvanceLog.findMany({ where: { processoId, resultado: { in: [...RESULTADOS_QUE_MOVEM_DE_FASE] } }, orderBy: { criadoEm: 'asc' }, select: { faseAtual: true, fasePretendida: true, criadoEm: true } }),
    prisma.phaseWorkflowInstance.findMany({ where: { processoId }, select: { faseMacroKey: true, createdAt: true } }),
    prisma.tarefa.findMany({ where: { processoId }, select: { faseMacroKey: true, statusTarefa: true, responsavelId: true, responsavel: { select: { nome: true } } } }),
  ])
  if (fasesDb.length === 0) return { fases: [], numeroDaFaseAtual: null, total: 0, proximaFaseLabel: null }

  const fases: FaseCadastrada[] = fasesDb.map((f) => ({ ...f, label: labelDaFasePorPhaseKey(f.phaseKey) ?? f.label }))
  const passagens = passagensPelasFases({ fases, logs, instancias, abertoEm: proc.dataInicio ?? proc.createdAt, faseAtualKey: proc.faseAtualKey })

  const porFase = new Map<string, { total: number; concluidas: number; semResponsavel: number; abertas: number; resp: Map<string, number> }>()
  for (const t of tarefas) {
    if (!t.faseMacroKey || STATUS_FORA_DA_CONTA.includes(t.statusTarefa)) continue
    const c = porFase.get(t.faseMacroKey) ?? { total: 0, concluidas: 0, semResponsavel: 0, abertas: 0, resp: new Map<string, number>() }
    c.total++
    const concluida = STATUS_CONCLUIDOS.includes(t.statusTarefa)
    if (concluida) c.concluidas++
    else { c.abertas++; if (t.responsavelId == null) c.semResponsavel++ }
    // Fase concluída: quem CONCLUIU manda no "responsável"; fase em curso: quem tem as abertas. Os dois contam; a tela escolhe pela fase.
    if (t.responsavel?.nome && (t.faseMacroKey === proc.faseAtualKey ? !concluida : concluida)) c.resp.set(t.responsavel.nome, (c.resp.get(t.responsavel.nome) ?? 0) + 1)
    porFase.set(t.faseMacroKey, c)
  }
  const tarefasPorFase = new Map<string, TarefasDaFase>(
    [...porFase].map(([k, v]) => [k, {
      total: v.total, concluidas: v.concluidas, semResponsavel: v.semResponsavel, abertas: v.abertas,
      responsaveis: [...v.resp].map(([nome, n]) => ({ nome, n })).sort((x, y) => y.n - x.n || x.nome.localeCompare(y.nome, 'pt-BR')),
    }]),
  )

  const requer = analise ? analise.requerRetificacao === true : null
  const caminho = montarCaminho({ fases, faseAtualKey: proc.faseAtualKey, requerRetificacao: requer, passagens, tarefas: tarefasPorFase })
  const atual = caminho.find((f) => f.estado === 'atual') ?? null
  const proximaKey = proc.faseAtualKey ? proximaFaseDoCaminho(fases.map((f) => ({ phaseKey: f.phaseKey, ordem: f.ordem, conditional: f.conditional, required: f.required })), proc.faseAtualKey, requer === true) : null
  return {
    fases: caminho,
    numeroDaFaseAtual: atual?.numero ?? null,
    total: caminho.length,
    proximaFaseLabel: proximaKey ? caminho.find((f) => f.phaseKey === proximaKey)?.label ?? null : null,
  }
}
