// scripts/reconciliar-escopo-documento.ts
// ============================================================================
// CORREÇÃO DE ESCOPO — 4 fases canônicas nascidas com escopo PROCESSO quando a
// regra real é DOCUMENTO: retificacao_registros, emissao_documental_retificada,
// traducao_juramentada, apostilamento (mandato "Catálogo de Fases", correção
// 20/09/2026, item 1).
//
// ACHADO ARQUITETURAL: `CatalogoFase.escopo` sozinho NÃO é a fonte real de
// cardinalidade para uma fase canônica — `resolverEscopoDaFase` dá precedência
// ao catálogo EM CÓDIGO (`src/lib/process-stage/fases-catalog.ts`) por design
// deliberado. A correção real, portanto, tem DUAS metades que precisam viajar
// juntas: o código (`fases-catalog.ts`, já alterado nesta mesma rodada) e o
// CADASTRO (`CatalogoFase.escopo`, via nova revisão publicada aqui) — senão a
// tela de Gerenciamento mostraria PROCESSO enquanto o motor já materializa
// DOCUMENTO, uma segunda verdade divergente que este script existe para evitar.
//
// RECONCILIAÇÃO — NENHUMA migration nova foi necessária. Reaproveita:
//   • `PhaseWorkflowInstance.previousInstanceId` (campo já existente) — a
//     instância LEGADA (escopo PROCESSO) nunca é tocada: não muda status, não
//     perde passo, não perde tarefa, não perde anexo/responsável/data/evento.
//     Fica exatamente como estava, e a instância NOVA aponta de volta pra ela
//     (auditável por FK, sem reescrever histórico).
//   • `proximoCiclo` (exportado de phase-advance.ts) — a obrigação por
//     documento nasce num CICLO NOVO da mesma fase, nunca dentro do ciclo
//     legado. Isso é o que garante, de graça, que a instância legada não
//     reabre nem processa (nada nela é chaveIdempotencia-compatível com o
//     plano novo, cardinalidade por documento).
//   • `materializarExecucaoDaFase` (fonte "RECONCILIACAO") — o MESMO
//     materializador canônico único. Ele já é idempotente por natureza
//     (chaveIdempotencia por passo×entidade×ciclo): rodar este script duas
//     vezes não duplica nada, porque a 2ª vez encontra `previousInstanceId`
//     apontando pra legada e PULA o processo inteiro.
//
// GARANTIAS (mandato):
//   • instância legada 100% preservada (nunca UPDATE nela, exceto leitura);
//   • tarefa concluída no escopo antigo permanece concluída e histórica;
//   • nenhuma conclusão é copiada de PROCESSO para DOCUMENTO — toda obrigação
//     nova nasce PENDENTE (estadoInicialPasso do motor, nunca herdado);
//   • zero duplicidade: reexecução não cria 2ª instância nova (idempotente
//     por `previousInstanceId` já setado) nem 2º passo (chaveIdempotencia);
//   • zero exclusão: nenhum DELETE em código nenhum deste script.
//
// USO:
//   npx tsx scripts/reconciliar-escopo-documento.ts                 → dry-run (só relatório, nada escrito)
//   npx tsx scripts/reconciliar-escopo-documento.ts --aplicar        → aplica no banco do PRISMA_DATABASE_URL atual
//   npx tsx scripts/reconciliar-escopo-documento.ts --aplicar --prod → exige também EU_CONFIRMO_ESCRITA_EM_PRODUCAO=1
// ============================================================================
import { prisma } from "../lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { publicarRevisaoCatalogoFase } from "../src/lib/motor/catalogo-fase-revisao"
import { materializarExecucaoDaFase } from "../src/services/materializar-fase"
import { proximoCiclo } from "../src/lib/motor/phase-advance"
import { STATUS_ATIVOS, STATUS_TERMINAIS } from "../lib/operacional/tarefa-canonica"
import type { WorkflowInstanceStatus } from "@prisma/client"

const APLICAR = process.argv.includes("--aplicar")
const ALVO_PROD = process.argv.includes("--prod")

const FASES_ALVO = [
  "retificacao_registros",
  "emissao_documental_retificada",
  "traducao_juramentada",
  "apostilamento",
] as const

// Estados que representam trabalho/posição REAL do processo nessa fase — únicos
// elegíveis a reconciliação. NAO_APLICAVEL/CANCELADO/SUPERSEDIDO/FALHOU não
// representam obrigação vigente: reconciliar por cima deles seria inventar
// trabalho sobre um ciclo que a própria operação já descartou — reportados
// como "revisão manual" em vez de decisão automática.
const ELEGIVEL_A_RECONCILIACAO: WorkflowInstanceStatus[] = [
  "ATIVO", "BLOQUEADO", "AGUARDANDO", "CONCLUIDO", "PENDENTE", "PENDENTE_DE_REGULARIZACAO",
]

const STATUS_CONCLUIDOS_TAREFA = ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI"]

interface RelatorioProcesso {
  processoId: number
  phaseKey: string
  instanciaLegadaId: number
  cicloLegado: number
  statusLegado: string
  tarefasAbertas: number
  tarefasConcluidas: number
  documentosAplicaveis: number
  jaReconciliado: boolean
  acao: "RECONCILIADO" | "PREVISTO" | "PULADO_JA_RECONCILIADO" | "PULADO_STATUS_NAO_ELEGIVEL" | "CONFLITO"
  novaInstanciaId?: number
  novoCiclo?: number
  novasTarefas?: number
  detalhe?: string
}

async function verificarAlvoSeguro() {
  const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`[reconciliar-escopo] alvo ${identificador(url)} classificado como ${classe} (tabelas=${retrato.tabelas}, requerentes=${retrato.requerentes})`)
  if (APLICAR && ALVO_PROD) {
    if (classe !== CLASSE.PRODUCAO) {
      console.error(`[reconciliar-escopo] RECUSADO: --prod foi passado mas o alvo não classifica como PRODUCAO (classe=${classe}). Nada foi escrito.`)
      process.exit(1)
    }
    if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") {
      console.error(`[reconciliar-escopo] RECUSADO: --prod exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'. Nada foi escrito.`)
      process.exit(1)
    }
  }
  if (APLICAR && !ALVO_PROD && classe === CLASSE.PRODUCAO) {
    console.error(`[reconciliar-escopo] RECUSADO: o alvo classifica como PRODUCAO mas --prod não foi passado. Nada foi escrito.`)
    process.exit(1)
  }
}

async function main() {
  await verificarAlvoSeguro()
  console.log(`[reconciliar-escopo] modo: ${APLICAR ? "APLICAR" : "DRY-RUN (nada será escrito)"}`)

  const relatorio = {
    revisoesPublicadas: [] as Array<{ phaseKey: string; escopoAnterior: string | null; revisaoAnterior?: number; revisaoNova?: number; jaCorrigido?: boolean }>,
    processos: [] as RelatorioProcesso[],
    totais: { processosAlcancados: 0, tarefasAbertas: 0, tarefasConcluidas: 0, documentosAplicaveis: 0, novasObrigacoesPrevistas: 0, conflitos: 0, registrosPreservados: 0, puladosJaReconciliados: 0, puladosStatusNaoElegivel: 0 },
  }

  // ── 1) publicar a revisão DOCUMENTO no CADASTRO (CatalogoFase) ────────────
  for (const phaseKey of FASES_ALVO) {
    const atual = await prisma.catalogoFase.findUnique({ where: { phaseKey } })
    if (!atual) {
      relatorio.revisoesPublicadas.push({ phaseKey, escopoAnterior: null, jaCorrigido: false })
      relatorio.totais.conflitos++
      continue
    }
    if (atual.escopo === "DOCUMENTO") {
      relatorio.revisoesPublicadas.push({ phaseKey, escopoAnterior: atual.escopo, jaCorrigido: true })
      continue
    }
    if (APLICAR) {
      const r = await publicarRevisaoCatalogoFase(prisma, atual, { ...atual, escopo: "DOCUMENTO" }, null)
      relatorio.revisoesPublicadas.push({ phaseKey, escopoAnterior: atual.escopo, revisaoAnterior: atual.revisaoAtual, revisaoNova: r.revisaoNova })
    } else {
      relatorio.revisoesPublicadas.push({ phaseKey, escopoAnterior: atual.escopo, revisaoAnterior: atual.revisaoAtual, revisaoNova: atual.revisaoAtual + 1 })
    }
  }

  // ── 2) reconciliar processos em andamento com instância legada ────────────
  for (const phaseKey of FASES_ALVO) {
    const instancias = await prisma.phaseWorkflowInstance.findMany({
      where: { faseMacroKey: phaseKey, processo: { faseAtualKey: { not: "finalizado" } } },
      orderBy: [{ processoId: "asc" }, { ciclo: "desc" }],
      include: { steps: { include: { tarefas: { select: { statusTarefa: true } } } } },
    })
    const legadoPorProcesso = new Map<number, (typeof instancias)[number]>()
    for (const inst of instancias) {
      if (!legadoPorProcesso.has(inst.processoId)) legadoPorProcesso.set(inst.processoId, inst)
    }

    for (const [processoId, legado] of legadoPorProcesso) {
      const tarefas = legado.steps.flatMap((s) => s.tarefas)
      const tarefasAbertas = tarefas.filter((t) => (STATUS_ATIVOS as string[]).includes(t.statusTarefa)).length
      const tarefasConcluidas = tarefas.filter((t) => STATUS_CONCLUIDOS_TAREFA.includes(t.statusTarefa)).length

      const jaReconciliado = await prisma.phaseWorkflowInstance.findFirst({
        where: { previousInstanceId: legado.id },
        select: { id: true },
      })

      const processo = await prisma.processo.findUnique({ where: { id: processoId }, select: { arvoreId: true } })
      const docsAplicaveis = processo?.arvoreId
        ? await prisma.documento.findMany({ where: { pessoa: { arvoreId: processo.arvoreId }, status: { not: "CANCELADO" } }, select: { id: true } })
        : []

      const linha: RelatorioProcesso = {
        processoId, phaseKey, instanciaLegadaId: legado.id, cicloLegado: legado.ciclo, statusLegado: legado.status,
        tarefasAbertas, tarefasConcluidas, documentosAplicaveis: docsAplicaveis.length,
        jaReconciliado: !!jaReconciliado, acao: "PREVISTO",
      }

      relatorio.totais.processosAlcancados++
      relatorio.totais.tarefasAbertas += tarefasAbertas
      relatorio.totais.tarefasConcluidas += tarefasConcluidas
      relatorio.totais.documentosAplicaveis += docsAplicaveis.length

      if (jaReconciliado) {
        linha.acao = "PULADO_JA_RECONCILIADO"
        relatorio.totais.puladosJaReconciliados++
        relatorio.processos.push(linha)
        continue
      }
      if (!ELEGIVEL_A_RECONCILIACAO.includes(legado.status)) {
        linha.acao = "PULADO_STATUS_NAO_ELEGIVEL"
        linha.detalhe = `status ${legado.status} não representa obrigação vigente — requer revisão manual, não reconciliação automática`
        relatorio.totais.puladosStatusNaoElegivel++
        relatorio.processos.push(linha)
        continue
      }

      relatorio.totais.novasObrigacoesPrevistas += docsAplicaveis.length

      if (APLICAR) {
        const novoCiclo = await proximoCiclo(processoId, phaseKey)
        const rel = await materializarExecucaoDaFase({
          processoId, faseMacroKey: phaseKey, ciclo: novoCiclo, fonte: "RECONCILIACAO",
        })
        if (rel.workflowInstanceId == null) {
          linha.acao = "CONFLITO"
          linha.detalhe = `materialização não produziu instância — estado ${rel.estado}, motivos: ${rel.motivos.map((m) => m.code).join(",")}`
          relatorio.totais.conflitos++
          relatorio.processos.push(linha)
          continue
        }
        // Preservação e auditabilidade: a legada NUNCA é escrita — só a NOVA
        // instância recebe a referência de volta.
        await prisma.phaseWorkflowInstance.update({
          where: { id: rel.workflowInstanceId },
          data: { previousInstanceId: legado.id },
        })
        await prisma.logAuditoria.create({
          data: {
            acao: "RECONCILIACAO_ESCOPO_DOCUMENTO",
            entidade: "PROCESSO",
            entidadeId: processoId,
            descricao: `Fase "${phaseKey}": escopo PROCESSO→DOCUMENTO (mandato Catálogo de Fases, correção 20/09/2026). Instância legada #${legado.id} (ciclo ${legado.ciclo}, status ${legado.status}) preservada intacta. Nova instância #${rel.workflowInstanceId} (ciclo ${novoCiclo}) com ${rel.tarefasCriadas} nova(s) obrigação(ões) por documento (${docsAplicaveis.length} documento(s) aplicável(is)).`,
            detalhes: {
              phaseKey, instanciaLegadaId: legado.id, cicloLegado: legado.ciclo, statusLegado: legado.status,
              novaInstanciaId: rel.workflowInstanceId, novoCiclo, documentosAplicaveis: docsAplicaveis.length,
              tarefasCriadas: rel.tarefasCriadas, tarefasPreexistentes: rel.tarefasPreexistentes,
            } as never,
          },
        })
        linha.acao = "RECONCILIADO"
        linha.novaInstanciaId = rel.workflowInstanceId
        linha.novoCiclo = novoCiclo
        linha.novasTarefas = rel.tarefasCriadas
        relatorio.totais.registrosPreservados++
      }
      relatorio.processos.push(linha)
    }
  }

  console.log(JSON.stringify(relatorio, null, 2))
  console.log(`\n[reconciliar-escopo] ${APLICAR ? "APLICADO" : "DRY-RUN"} — processos alcançados: ${relatorio.totais.processosAlcancados}, reconciliados: ${relatorio.totais.registrosPreservados}, já reconciliados (pulados): ${relatorio.totais.puladosJaReconciliados}, status não elegível (pulados): ${relatorio.totais.puladosStatusNaoElegivel}, conflitos: ${relatorio.totais.conflitos}`)
  if (relatorio.totais.conflitos > 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
