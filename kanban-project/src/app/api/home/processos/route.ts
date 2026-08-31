// ============================================================================
// PROCESSOS EM ANDAMENTO — a tabela da Home.
//
// NADA aqui é calculado do zero. As duas grandezas que já têm motor próprio
// chegam pelas MESMAS portas em lote que o Kanban usa:
//   • progresso → resolveOperationalProjectionBatch (projeção operacional canônica)
//   • SLA       → resolveSlaProjectionBatch (engine única de prazo)
// Recalcular qualquer uma delas aqui criaria uma segunda fonte de verdade.
//
// O que ESTE endpoint acrescenta são três derivações que o mockup pede e que
// o Processo não guarda como campo — porque quem as guarda é a TAREFA:
//
//   pendências  contagem de tarefas ABERTAS do processo
//   prioridade  a MAIOR prioridade entre essas tarefas abertas
//   responsável o responsável da tarefa aberta de maior prioridade
//               (empate: a de prazo mais próximo; sem responsável: null)
//
// São derivações declaradas, não campos novos: o Processo continua sem
// "prioridade" e sem "responsável" próprios, e nada é escrito.
// ============================================================================
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { resolveOperationalProjectionBatch } from "@/src/lib/process-stage/operational-projection"
import { resolveSlaProjectionBatch } from "@/src/lib/process-stage/sla-projection"

/** Ordem de severidade — a maior vence ao agregar as tarefas do processo. */
const PESO_PRIORIDADE = { URGENTE: 4, ALTA: 3, MEDIA: 2, BAIXA: 1 } as const
type Prioridade = keyof typeof PESO_PRIORIDADE

/** Uma tarefa está ABERTA quando ainda pode receber trabalho. */
const STATUS_ABERTOS = [
  "NAO_INICIADA",
  "EM_ANDAMENTO",
  "AGUARDANDO_CLIENTE",
  "AGUARDANDO_TERCEIRO",
  "BLOQUEADA",
] as const

export async function GET(request: NextRequest) {
  // Mesmo portão da lista de processos: quem não vê processo não vê a tabela.
  const negado = await verificarPermissao(request, "processos.ver")
  if (negado) return negado

  const url = new URL(request.url)
  const limite = Math.min(Math.max(Number(url.searchParams.get("limite") ?? 6), 1), 50)

  // Processos operacionais: os que ainda não concluíram.
  const processos = await prisma.processo.findMany({
    where: { dataConclusao: null },
    select: { id: true, nome: true, codigo: true, pais: true, paisCanonico: { select: { countryKey: true, countryLabel: true, flag: true } }, faseAtualKey: true },
    orderBy: { updatedAt: "desc" },
    take: limite,
  })
  if (processos.length === 0) return NextResponse.json({ processos: [], total: 0 })

  const ids = processos.map((p) => p.id)

  // As tarefas abertas de TODOS os processos numa consulta — sem N+1.
  const tarefas = await prisma.tarefa.findMany({
    where: {
      processoId: { in: ids },
      concluida: false,
      statusTarefa: { in: STATUS_ABERTOS as unknown as never[] },
    },
    select: {
      processoId: true,
      prioridade: true,
      dataPrazo: true,
      responsavel: { select: { id: true, nome: true } },
    },
  })

  const [projecoes, slas, total] = await Promise.all([
    resolveOperationalProjectionBatch(ids),
    resolveSlaProjectionBatch(ids),
    prisma.processo.count({ where: { dataConclusao: null } }),
  ])

  // Agrega por processo: contagem, maior prioridade e o responsável dela.
  const agregado = new Map<number, { pendencias: number; prioridade: Prioridade | null; responsavel: { id: number; nome: string } | null; prazo: Date | null }>()
  for (const t of tarefas) {
    if (t.processoId == null) continue
    const atual = agregado.get(t.processoId) ?? { pendencias: 0, prioridade: null, responsavel: null, prazo: null }
    atual.pendencias += 1
    const peso = PESO_PRIORIDADE[t.prioridade as Prioridade] ?? 0
    const pesoAtual = atual.prioridade ? PESO_PRIORIDADE[atual.prioridade] : 0
    // Empate na prioridade decide pelo prazo mais próximo; sem prazo perde.
    const maisUrgente =
      peso > pesoAtual ||
      (peso === pesoAtual && t.dataPrazo != null && (atual.prazo == null || t.dataPrazo < atual.prazo))
    if (maisUrgente) {
      atual.prioridade = t.prioridade as Prioridade
      atual.responsavel = t.responsavel
      atual.prazo = t.dataPrazo
    }
    agregado.set(t.processoId, atual)
  }

  const projPorProc = new Map(projecoes.map((pr) => [Number(pr.processId), pr]))
  const slaPorProc = new Map(slas.map((s) => [Number(s.processoId), s]))

  return NextResponse.json({
    total,
    processos: processos.map((p) => {
      const ag = agregado.get(p.id)
      return {
        id: p.id,
        nome: p.nome,
        codigo: p.codigo,
        pais: p.pais,
        faseAtualKey: p.faseAtualKey,
        // Vêm dos motores canônicos, intactos.
        progresso: projPorProc.get(p.id)?.progress.percentage ?? 0,
        sla: slaPorProc.get(p.id) ?? null,
        // Derivações declaradas acima.
        pendencias: ag?.pendencias ?? 0,
        prioridade: ag?.prioridade ?? null,
        responsavel: ag?.responsavel ?? null,
      }
    }),
  })
}
