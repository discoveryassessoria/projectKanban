// scripts/reconciliar-workflow-emissao-documental.ts
// ============================================================================
// RECONCILIAÇÃO dos processos em andamento após publicar o conteúdo corrigido
// de Emissão Documental (4 passos) e Emissão Documental Retificada (5 passos)
// — mandato "Catálogo de Fases", correção 20/09/2026, itens 2/3/4.
//
// MESMO PADRÃO SEGURO de `reconciliar-escopo-documento.ts` (item 1), agora
// aplicado a uma mudança de CONTEÚDO DE PASSOS em vez de escopo: a instância
// LEGADA (workflowVersion antiga, ex. 1 passo) nunca é tocada — status,
// passos, tarefas, anexos, responsáveis e datas ficam exatamente como estavam.
// A obrigação sob a revisão NOVA nasce num CICLO NOVO da mesma fase
// (`previousInstanceId` aponta de volta pra legada, auditável por FK), nunca
// dentro do ciclo antigo — trocar o passo "Solicitar certidão" (1 passo, chave
// própria) por "Enviar requerimento ao cartório" (4 passos, chaves diferentes)
// não é a mesma obrigação lógica, então não há como "adaptar" a tarefa antiga
// sem inventar uma equivalência que ninguém declarou.
//
// IDEMPOTENTE: processo já reconciliado (existe instância com
// previousInstanceId apontando pra legada) é detectado e pulado.
//
// USO:
//   npx tsx scripts/reconciliar-workflow-emissao-documental.ts                 → dry-run
//   npx tsx scripts/reconciliar-workflow-emissao-documental.ts --aplicar        → aplica no banco do PRISMA_DATABASE_URL atual
//   npx tsx scripts/reconciliar-workflow-emissao-documental.ts --aplicar --prod → exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'
// ============================================================================
import { prisma } from "../lib/prisma"
import { identificador, retratar, classificar, CLASSE } from "../lib/db/identidade-banco.mjs"
import { materializarExecucaoDaFase } from "../src/services/materializar-fase"
import { proximoCiclo } from "../src/lib/motor/phase-advance"
import type { WorkflowInstanceStatus } from "@prisma/client"

const APLICAR = process.argv.includes("--aplicar")
const ALVO_PROD = process.argv.includes("--prod")

const FASES_ALVO = ["emissao_documental", "emissao_documental_retificada"] as const

const ELEGIVEL_A_RECONCILIACAO: WorkflowInstanceStatus[] = [
  "ATIVO", "BLOQUEADO", "AGUARDANDO", "CONCLUIDO", "PENDENTE", "PENDENTE_DE_REGULARIZACAO",
]

async function verificarAlvoSeguro() {
  const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ""
  const retrato = await retratar(prisma)
  const classe = classificar(retrato)
  console.log(`[reconciliar-workflow-emissao] alvo ${identificador(url)} classificado como ${classe} (tabelas=${retrato.tabelas}, requerentes=${retrato.requerentes})`)
  if (APLICAR && ALVO_PROD) {
    if (classe !== CLASSE.PRODUCAO) {
      console.error(`[reconciliar-workflow-emissao] RECUSADO: --prod passado mas alvo não é PRODUCAO (classe=${classe}). Nada escrito.`)
      process.exit(1)
    }
    if (process.env.EU_CONFIRMO_ESCRITA_EM_PRODUCAO !== "SIM, ESCREVER EM PRODUCAO") {
      console.error(`[reconciliar-workflow-emissao] RECUSADO: --prod exige EU_CONFIRMO_ESCRITA_EM_PRODUCAO='SIM, ESCREVER EM PRODUCAO'. Nada escrito.`)
      process.exit(1)
    }
  }
  if (APLICAR && !ALVO_PROD && classe === CLASSE.PRODUCAO) {
    console.error(`[reconciliar-workflow-emissao] RECUSADO: alvo é PRODUCAO mas --prod não foi passado. Nada escrito.`)
    process.exit(1)
  }
}

async function main() {
  await verificarAlvoSeguro()
  console.log(`[reconciliar-workflow-emissao] modo: ${APLICAR ? "APLICAR" : "DRY-RUN (nada será escrito)"}`)

  const relatorio = {
    processos: [] as Array<Record<string, unknown>>,
    totais: { processosAlcancados: 0, reconciliados: 0, puladosJaReconciliados: 0, puladosStatusNaoElegivel: 0, puladosVersaoJaAtual: 0, conflitos: 0 },
  }

  for (const phaseKey of FASES_ALVO) {
    const wf = await prisma.phaseInternalWorkflow.findFirst({ where: { phaseKey, wfUid: `all::${phaseKey}` }, select: { id: true, versao: true } })
    if (!wf) { relatorio.totais.conflitos++; continue }

    const instancias = await prisma.phaseWorkflowInstance.findMany({
      where: { faseMacroKey: phaseKey, processo: { faseAtualKey: { not: "finalizado" } } },
      orderBy: [{ processoId: "asc" }, { ciclo: "desc" }],
      select: { id: true, processoId: true, ciclo: true, status: true, workflowVersion: true },
    })
    const legadoPorProcesso = new Map<number, (typeof instancias)[number]>()
    for (const inst of instancias) {
      if (!legadoPorProcesso.has(inst.processoId)) legadoPorProcesso.set(inst.processoId, inst)
    }

    for (const [processoId, legado] of legadoPorProcesso) {
      relatorio.totais.processosAlcancados++
      const linha: Record<string, unknown> = { processoId, phaseKey, instanciaLegadaId: legado.id, cicloLegado: legado.ciclo, statusLegado: legado.status, workflowVersionLegado: legado.workflowVersion }

      if (legado.workflowVersion != null && legado.workflowVersion >= wf.versao) {
        linha.acao = "PULADO_VERSAO_JA_ATUAL"
        relatorio.totais.puladosVersaoJaAtual++
        relatorio.processos.push(linha)
        continue
      }
      const jaReconciliado = await prisma.phaseWorkflowInstance.findFirst({ where: { previousInstanceId: legado.id }, select: { id: true } })
      if (jaReconciliado) {
        linha.acao = "PULADO_JA_RECONCILIADO"
        relatorio.totais.puladosJaReconciliados++
        relatorio.processos.push(linha)
        continue
      }
      if (!ELEGIVEL_A_RECONCILIACAO.includes(legado.status)) {
        linha.acao = "PULADO_STATUS_NAO_ELEGIVEL"
        relatorio.totais.puladosStatusNaoElegivel++
        relatorio.processos.push(linha)
        continue
      }

      if (APLICAR) {
        const novoCiclo = await proximoCiclo(processoId, phaseKey)
        const rel = await materializarExecucaoDaFase({ processoId, faseMacroKey: phaseKey, ciclo: novoCiclo, fonte: "RECONCILIACAO" })
        if (rel.workflowInstanceId == null) {
          linha.acao = "CONFLITO"
          linha.detalhe = `estado ${rel.estado}, motivos: ${rel.motivos.map((m) => m.code).join(",")}`
          relatorio.totais.conflitos++
          relatorio.processos.push(linha)
          continue
        }
        await prisma.phaseWorkflowInstance.update({ where: { id: rel.workflowInstanceId }, data: { previousInstanceId: legado.id } })
        await prisma.logAuditoria.create({
          data: {
            acao: "RECONCILIACAO_WORKFLOW_EMISSAO_DOCUMENTAL",
            entidade: "PROCESSO",
            entidadeId: processoId,
            descricao: `Fase "${phaseKey}": conteúdo do workflow corrigido (mandato Catálogo de Fases, 20/09/2026). Instância legada #${legado.id} (ciclo ${legado.ciclo}, workflowVersion ${legado.workflowVersion}) preservada intacta. Nova instância #${rel.workflowInstanceId} (ciclo ${novoCiclo}, workflowVersion ${wf.versao}) com ${rel.passosTotais} passo(s) publicado(s), ${rel.tarefasCriadas} nova(s) tarefa(s).`,
            detalhes: { phaseKey, instanciaLegadaId: legado.id, cicloLegado: legado.ciclo, novaInstanciaId: rel.workflowInstanceId, novoCiclo, workflowVersionNova: wf.versao, passosTotais: rel.passosTotais, tarefasCriadas: rel.tarefasCriadas } as never,
          },
        })
        linha.acao = "RECONCILIADO"
        linha.novaInstanciaId = rel.workflowInstanceId
        linha.novoCiclo = novoCiclo
        linha.passosTotais = rel.passosTotais
        linha.tarefasCriadas = rel.tarefasCriadas
        relatorio.totais.reconciliados++
      } else {
        linha.acao = "PREVISTO"
      }
      relatorio.processos.push(linha)
    }
  }

  console.log(JSON.stringify(relatorio, null, 2))
  console.log(`\n[reconciliar-workflow-emissao] ${APLICAR ? "APLICADO" : "DRY-RUN"} — alcançados: ${relatorio.totais.processosAlcancados}, reconciliados: ${relatorio.totais.reconciliados}, já reconciliados: ${relatorio.totais.puladosJaReconciliados}, versão já atual: ${relatorio.totais.puladosVersaoJaAtual}, status não elegível: ${relatorio.totais.puladosStatusNaoElegivel}, conflitos: ${relatorio.totais.conflitos}`)
  if (relatorio.totais.conflitos > 0) process.exitCode = 1
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
