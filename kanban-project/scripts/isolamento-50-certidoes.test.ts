// scripts/isolamento-50-certidoes.test.ts
//
// UMA CERTIDÃO JAMAIS PODE ALTERAR AS OUTRAS.
//
// Este é o teste que separa "funciona" de "funciona em escala". Com uma certidão, o
// escopo da unidade é indistinguível do escopo da fase: qualquer implementação passa.
// Com cinquenta, a diferença é a distância entre reabrir uma tarefa e destruir
// quarenta e nove trabalhos que estavam certos.
//
//   1 processo · 10 pessoas · 50 certidões · 5 etapas cada = 250 instâncias operacionais
//
// A prova é por FOTOGRAFIA: o estado das 250 instâncias e das execuções delas é
// registrado antes, e comparado depois, linha a linha. Não se cobra "parece igual" —
// cobra-se que as 245 instâncias não envolvidas estejam BYTE A BYTE como estavam.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/isolamento-50-certidoes.test.ts

import { PrismaClient } from "@prisma/client"
import { executarRetrocesso } from "../src/services/retrocesso-de-fase"
import { planejarReabertura, executarReabertura } from "../src/services/reabertura-de-execucao"
import { garantirTentativa, tentativasDoPasso, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"
import { congelarVersaoVigente } from "../src/services/versao-publicada"

const prisma = new PrismaClient()
const M = "ESCALA50"
const PESSOAS = 10
const DOCS_POR_PESSOA = 5
const ETAPAS = ["solicitar", "aguardar", "receber", "conferir", "validar"] as const
const DEPS: Record<string, string[]> = {
  solicitar: [], aguardar: ["solicitar"], receber: ["aguardar"], conferir: ["receber"], validar: ["conferir"],
}

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: M } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  for (const p of procs) if (p.arvoreId) {
    await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: p.arvoreId } } })
    await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
    await prisma.arvore.deleteMany({ where: { id: p.arvoreId } })
  }
  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { wfUid: { startsWith: `${M}::` } }, select: { id: true } })
  for (const wf of wfs) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.macroWorkflow.deleteMany({ where: { name: { startsWith: M } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { code: { startsWith: M } } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: "esc50_" } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: M } } })
  await prisma.usuario.deleteMany({ where: { email: { startsWith: `${M.toLowerCase()}-` } } })
}

/** O estado de TODAS as instâncias, para comparar antes e depois — sem tolerância. */
async function fotografar(processoId: number) {
  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    where: { processoId },
    select: {
      id: true, stepKey: true, status: true, completedAt: true, startedAt: true,
      documentoId: true, necessidadeId: true, pessoaId: true, responsavelId: true, prazo: true,
    },
    orderBy: { id: "asc" },
  })
  const execs = await prisma.stepExecution.findMany({
    where: { stepInstance: { processoId } },
    select: { id: true, stepInstanceId: true, sequencia: true, status: true, completedAt: true, supersededAt: true, motivo: true },
    orderBy: { id: "asc" },
  })
  const docs = await prisma.documento.findMany({
    where: { pessoa: { arvore: { processos: { some: { id: processoId } } } } },
    select: { id: true, status: true, substituidoEm: true, derivadoDeId: true },
    orderBy: { id: "asc" },
  })
  return { passos, execs, docs }
}

async function main() {
  await limpar()
  console.log(`\nISOLAMENTO EM ESCALA — ${PESSOAS} pessoas · ${PESSOAS * DOCS_POR_PESSOA} certidões · ${ETAPAS.length} etapas\n`)

  // ── PALCO ────────────────────────────────────────────────────────────────
  const tipo = await prisma.tipoProcessoNacionalidade.create({
    data: {
      code: `${M}_TIPO`, name: `${M} tipo`, ativo: true,
      countryKey: "esc", countryLabel: "Esc", nationalityKey: "esc", nationalityLabel: "Esc",
      modalityKey: "esc", modalityLabel: "Esc",
    },
    select: { id: true },
  })
  const fEmissao = await prisma.catalogoFase.create({
    data: { phaseKey: "esc50_emissao", label: "Emissão (escala)", escopo: "DOCUMENTO", ordemPadrao: 10 },
    select: { phaseKey: true },
  })
  const fAnalise = await prisma.catalogoFase.create({
    data: { phaseKey: "esc50_analise", label: "Análise (escala)", escopo: "DOCUMENTO", ordemPadrao: 20 },
    select: { phaseKey: true },
  })
  await prisma.macroWorkflow.create({
    data: {
      tipoProcessoId: tipo.id, name: `${M} macro`, versao: 1,
      fases: {
        create: [
          { phaseKey: fEmissao.phaseKey, label: "Emissão (escala)", ordem: 1, required: true },
          { phaseKey: fAnalise.phaseKey, label: "Análise (escala)", ordem: 2, required: true },
        ],
      },
    },
  })
  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${M}::emissao`, phaseKey: fEmissao.phaseKey, name: `${M} emissão`, versao: 1, execucao: "SEQUENCIAL",
      passos: {
        create: ETAPAS.map((k, i) => ({
          key: k, label: k.charAt(0).toUpperCase() + k.slice(1), ordem: i + 1,
          cardinalidade: "DOCUMENTO", createsTask: true, required: true, slaDays: 3,
          executorKey: "padrao", dependeDe: DEPS[k],
        })),
      },
    },
    select: { id: true, passos: { select: { id: true, key: true } } },
  })
  await congelarVersaoVigente(wf.id, "CRIACAO")

  const actor = await prisma.usuario.create({
    data: { nome: `${M} Admin`, email: `${M.toLowerCase()}-admin@teste.local`, senha: "x", tipo: "admin" },
    select: { id: true },
  })
  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: {
      nome: `${M} processo`, arvoreId: arv.id, workflowRuntime: "v2",
      faseAtualKey: fAnalise.phaseKey, tipoProcessoMotorId: tipo.id,
    },
    select: { id: true },
  })
  const item = await prisma.itemCatalogo.create({ data: { code: `${M}_ITEM`, name: "Certidão", natureza: "SERVICO" }, select: { id: true } })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: proc.id, faseMacroKey: fEmissao.phaseKey, ciclo: 1, status: "ATIVO",
      workflowDefinitionId: wf.id, workflowVersion: 1, chaveIdempotencia: `${M}-inst`,
    },
    select: { id: true },
  })

  const concluidoEm = new Date("2026-08-12T14:00:00Z")
  /** `[pessoaIdx][docIdx][stepKey] = stepInstanceId` */
  const mapa: number[][] = []
  const idPorEtapa: Array<Record<string, number>> = []
  let docGlobal = 0

  for (let pi = 0; pi < PESSOAS; pi++) {
    const pessoa = await prisma.pessoa.create({
      data: { nome: `Pessoa${pi}`, sobrenome: `Escala`, arvoreId: arv.id }, select: { id: true },
    })
    const docsDaPessoa: number[] = []
    for (let di = 0; di < DOCS_POR_PESSOA; di++) {
      const nec = await prisma.necessidadeDocumental.create({
        data: {
          processoId: proc.id, pessoaId: pessoa.id, status: "ATENDIDA",
          itemCatalogoId: item.id, chaveIdempotencia: `${M}-nec-${pi}-${di}`,
        },
        select: { id: true },
      })
      const doc = await prisma.documento.create({
        data: {
          pessoaId: pessoa.id, tipo: "CERTIDAO_NASCIMENTO", status: "RECEBIDO",
          necessidadeId: nec.id, descricao: `Certidão ${pi}-${di}`,
          livro: `L${pi}`, folha: `F${di}`,
        },
        select: { id: true },
      })
      docsDaPessoa.push(doc.id)
      const porEtapa: Record<string, number> = {}
      for (const [i, k] of ETAPAS.entries()) {
        const si = await prisma.phaseWorkflowStepInstance.create({
          data: {
            workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: fEmissao.phaseKey, ciclo: 1,
            stepKey: k, ordem: i + 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
            status: "CONCLUIDO", completedAt: concluidoEm, dependeDeStepKeys: DEPS[k] as never,
            documentoId: doc.id, necessidadeId: nec.id, pessoaId: pessoa.id,
            stepDefinitionId: wf.passos.find((x) => x.key === k)!.id, stepDefinitionVersion: 1,
            chaveIdempotencia: `${M}-${pi}-${di}-${k}`,
          },
          select: { id: true },
        })
        await garantirTentativa(si.id, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "CONCLUIDO", completedAt: concluidoEm })
        porEtapa[k] = si.id
      }
      idPorEtapa.push(porEtapa)
      docGlobal++
    }
    mapa.push(docsDaPessoa)
  }

  const totalInstancias = await prisma.phaseWorkflowStepInstance.count({ where: { processoId: proc.id } })
  check(`o palco tem ${PESSOAS * DOCS_POR_PESSOA} certidões e ${PESSOAS * DOCS_POR_PESSOA * ETAPAS.length} instâncias`,
    docGlobal === PESSOAS * DOCS_POR_PESSOA && totalInstancias === PESSOAS * DOCS_POR_PESSOA * ETAPAS.length,
    `${docGlobal} docs, ${totalInstancias} instâncias`)
  check("todas concluídas",
    (await prisma.phaseWorkflowStepInstance.count({ where: { processoId: proc.id, status: "CONCLUIDO" } })) === totalInstancias)

  // ══════════════════════════════════════════════════════════════
  secao("TESTE 4a — RETROCEDER não reabre nenhuma das 50")
  // ══════════════════════════════════════════════════════════════
  const antesRetro = await fotografar(proc.id)
  const rRetro = await executarRetrocesso({
    processoId: proc.id, faseDestino: fEmissao.phaseKey, motivoCodigo: "CORRECAO_CADASTRO",
    justificativa: "Voltar para a Emissão para refazer uma certidão.", actorId: actor.id,
  })
  check("o retrocesso acontece", rRetro.ok, JSON.stringify(rRetro))
  const depoisRetro = await fotografar(proc.id)

  // A COMPARAÇÃO É SOBRE O QUE JÁ EXISTIA. Voltar para a fase abre uma VISITA NOVA, e
  // as obrigações dela nascem herdando o estado — isso é MATERIALIZAÇÃO, que o §11
  // distingue de reabertura. Contar as linhas novas como "mudança" reprovaria o motor
  // por fazer o que ele deve.
  const idsAntes = new Set(antesRetro.passos.map((x) => x.id))
  const mudaramNoRetro = depoisRetro.passos.filter((d) => {
    if (!idsAntes.has(d.id)) return false
    const a = antesRetro.passos.find((x) => x.id === d.id)!
    return a.status !== d.status || a.completedAt?.toISOString() !== d.completedAt?.toISOString()
  })
  check("NENHUMA das instâncias que já existiam mudou de estado", mudaramNoRetro.length === 0,
    JSON.stringify(mudaramNoRetro.slice(0, 3).map((x) => [x.id, x.stepKey, x.status])))

  const execIdsAntes = new Set(antesRetro.execs.map((x) => x.id))
  const execsAlteradas = depoisRetro.execs.filter((d) => {
    if (!execIdsAntes.has(d.id)) return false
    const a = antesRetro.execs.find((x) => x.id === d.id)!
    return a.status !== d.status || a.supersededAt?.toISOString() !== d.supersededAt?.toISOString()
  })
  check("NENHUMA execução existente foi alterada ou arquivada", execsAlteradas.length === 0,
    JSON.stringify(execsAlteradas.slice(0, 3)))
  // E o que nasceu nasceu HERDADO, não reaberto: nenhuma obrigação nova está em aberto
  // com o trabalho anterior concluído.
  const novasEmAberto = depoisRetro.passos.filter((d) => !idsAntes.has(d.id) && d.status !== "CONCLUIDO")
  check("  e as obrigações da visita nova herdaram o estado concluído", novasEmAberto.length === 0,
    JSON.stringify(novasEmAberto.slice(0, 3).map((x) => [x.stepKey, x.status])))
  check("os documentos não foram tocados",
    JSON.stringify(depoisRetro.docs) === JSON.stringify(antesRetro.docs))

  // ══════════════════════════════════════════════════════════════
  secao("TESTE 4b — reabrir a certidão da PESSOA 7 / DOCUMENTO 31")
  // ══════════════════════════════════════════════════════════════
  // Índice global 30 (0-based) = a 31ª certidão. Pessoa 6 (0-based) = a 7ª.
  const alvoIdx = 30
  const alvo = idPorEtapa[alvoIdx]
  const idsDoAlvo = new Set(Object.values(alvo))
  const alvoVigente = await prisma.phaseWorkflowStepInstance.findFirst({
    where: { processoId: proc.id, stepKey: "solicitar", documentoId: (await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: alvo.solicitar }, select: { documentoId: true } }))!.documentoId },
    orderBy: { id: "desc" }, select: { id: true, documentoId: true, pessoaId: true },
  })
  const idSolicitar = alvoVigente!.id

  const plano = await planejarReabertura(idSolicitar)
  check("o plano identifica QUAL pessoa e QUAL documento",
    plano?.identidade.pessoaNome === "Pessoa6 Escala" && plano?.identidade.documentoId === alvoVigente!.documentoId,
    JSON.stringify(plano?.identidade))
  check(`  e diz que as outras ${PESSOAS * DOCS_POR_PESSOA - 1} unidades ficam intactas`,
    plano?.outrasUnidadesNaFase === PESSOAS * DOCS_POR_PESSOA - 1, String(plano?.outrasUnidadesNaFase))
  check("  a cadeia dependente é a DESTE documento — 4 etapas, não 200",
    plano?.dependentesDaMesmaUnidade.length === 4,
    JSON.stringify(plano?.dependentesDaMesmaUnidade.map((d) => d.stepKey)))

  // ── SOMENTE ESTA TAREFA ──
  const antesUm = await fotografar(proc.id)
  const rUm = await executarReabertura({
    stepInstanceId: idSolicitar, motivoCodigo: "ERRO_OPERACIONAL",
    justificativa: "Nome da mãe divergente nesta certidão.", comDependentes: false, actorId: actor.id,
  })
  check("a reabertura acontece", rUm.ok, JSON.stringify(rUm))
  const depoisUm = await fotografar(proc.id)

  const alteradosUm = depoisUm.passos.filter((d) => {
    const a = antesUm.passos.find((x) => x.id === d.id)
    return !a || a.status !== d.status || a.completedAt?.toISOString() !== d.completedAt?.toISOString()
  })
  const docsDoAlvo = new Set([alvoVigente!.documentoId])
  check("TESTE 4: as instâncias alteradas pertencem TODAS ao documento alvo",
    alteradosUm.every((x) => docsDoAlvo.has(x.documentoId)),
    JSON.stringify(alteradosUm.filter((x) => !docsDoAlvo.has(x.documentoId)).slice(0, 5).map((x) => [x.id, x.stepKey, x.documentoId])))
  const outrasInstancias = depoisUm.passos.filter((x) => !docsDoAlvo.has(x.documentoId))
  const outrasAntes = antesUm.passos.filter((x) => !docsDoAlvo.has(x.documentoId))
  check(`  as ${outrasInstancias.length} instâncias dos outros 49 documentos estão IDÊNTICAS`,
    JSON.stringify(outrasInstancias) === JSON.stringify(outrasAntes))
  const execsOutras = depoisUm.execs.filter((e) => !idsDoAlvoOuDoc(e.stepInstanceId, depoisUm.passos, docsDoAlvo))
  const execsOutrasAntes = antesUm.execs.filter((e) => !idsDoAlvoOuDoc(e.stepInstanceId, antesUm.passos, docsDoAlvo))
  check("  e as execuções delas também", JSON.stringify(execsOutras) === JSON.stringify(execsOutrasAntes))

  const t = await tentativasDoPasso(idSolicitar)
  check("  a etapa alvo ganhou execução nova, com a anterior arquivada",
    t.length === 2 && t[0].supersededAt != null && t[0].completedAt != null)
  const aguardarAlvo = depoisUm.passos.find((x) => x.documentoId === alvoVigente!.documentoId && x.stepKey === "aguardar")
  // "SOMENTE ESTA TAREFA" respeita a escolha: o dependente CONCLUÍDO continua
  // concluído — o administrador sabe se aquele trabalho ainda vale, e não mandou
  // refazê-lo. Se estivesse EM VOO, voltaria a esperar, porque não teria como
  // prosseguir com a dependência aberta.
  check("  'somente esta tarefa': o dependente concluído CONTINUA concluído",
    aguardarAlvo?.status === "CONCLUIDO", String(aguardarAlvo?.status))
  const alcancadosAlvo = alteradosUm.filter((x) => x.id !== idSolicitar)
  check("  e nenhuma outra etapa foi alterada por esta escolha", alcancadosAlvo.length === 0,
    JSON.stringify(alcancadosAlvo.map((x) => [x.stepKey, x.status])))

  // ── ESTA + DEPENDENTES, noutro documento ──
  secao("TESTE 5 — cadeia dependente, e só a da mesma unidade")
  const outroIdx = 12
  const outroDocId = (await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: idPorEtapa[outroIdx].solicitar }, select: { documentoId: true },
  }))!.documentoId
  const outroSolicitar = (await prisma.phaseWorkflowStepInstance.findFirst({
    where: { processoId: proc.id, stepKey: "solicitar", documentoId: outroDocId },
    orderBy: { id: "desc" }, select: { id: true },
  }))!.id

  const antesCadeia = await fotografar(proc.id)
  const rCadeia = await executarReabertura({
    stepInstanceId: outroSolicitar, motivoCodigo: "ERRO_OPERACIONAL",
    justificativa: "Refazer o pedido desta certidão e o que depende dele.",
    comDependentes: true, actorId: actor.id,
  })
  check("a reabertura em cadeia acontece", rCadeia.ok, JSON.stringify(rCadeia))
  const depoisCadeia = await fotografar(proc.id)

  const alteradosCadeia = depoisCadeia.passos.filter((d) => {
    const a = antesCadeia.passos.find((x) => x.id === d.id)
    return !a || a.status !== d.status
  })
  check("TESTE 5: TODAS as instâncias afetadas são do MESMO documento",
    alteradosCadeia.every((x) => x.documentoId === outroDocId),
    JSON.stringify(alteradosCadeia.filter((x) => x.documentoId !== outroDocId).slice(0, 5).map((x) => [x.stepKey, x.documentoId])))
  check("  as 5 etapas daquele documento foram alcançadas", alteradosCadeia.length === ETAPAS.length,
    String(alteradosCadeia.length))
  const homonimas = depoisCadeia.passos.filter((x) => x.stepKey === "aguardar" && x.documentoId !== outroDocId)
  const homonimasAntes = antesCadeia.passos.filter((x) => x.stepKey === "aguardar" && x.documentoId !== outroDocId)
  check("  as etapas HOMÔNIMAS dos outros 49 documentos não foram tocadas",
    JSON.stringify(homonimas) === JSON.stringify(homonimasAntes))

  // ══════════════════════════════════════════════════════════════
  secao("TESTE 8 — o progresso da fase não é zerado")
  // ══════════════════════════════════════════════════════════════
  const vigente = await prisma.phaseWorkflowInstance.findFirst({
    where: { processoId: proc.id, faseMacroKey: fEmissao.phaseKey, status: "ATIVO" },
    orderBy: { ciclo: "desc" }, select: { id: true },
  })
  const totalFase = await prisma.phaseWorkflowStepInstance.count({ where: { workflowInstanceId: vigente!.id, obrigatorio: true } })
  const conclFase = await prisma.phaseWorkflowStepInstance.count({
    where: { workflowInstanceId: vigente!.id, obrigatorio: true, status: "CONCLUIDO" },
  })
  const pct = Math.round((conclFase / Math.max(totalFase, 1)) * 100)
  console.log(`      progresso da fase: ${conclFase}/${totalFase} = ${pct}%`)
  check("o progresso NÃO foi para 0%", pct > 0, `${pct}%`)
  check("  nem continua 100% — há trabalho reaberto", pct < 100, `${pct}%`)
  check("  e reflete só as 2 certidões mexidas (≈96%)", pct >= 90 && pct < 100, `${pct}%`)

  // ══════════════════════════════════════════════════════════════
  secao("TESTE 7 — o ciclo completo: concluída → reabrir → executar → concluir")
  // ══════════════════════════════════════════════════════════════
  //
  // Reabrir é meia prova. O que importa é o roteiro voltar a andar depois: a etapa
  // reaberta conclui de novo, o dependente é liberado pela dependência, conclui, e a
  // execução anterior continua inteira ao lado da nova.
  const cicloIdx = 44
  const cicloDoc = (await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: idPorEtapa[cicloIdx].solicitar }, select: { documentoId: true },
  }))!.documentoId
  const passoDe = async (k: string) =>
    (await prisma.phaseWorkflowStepInstance.findFirst({
      where: { processoId: proc.id, stepKey: k, documentoId: cicloDoc },
      orderBy: { id: "desc" }, select: { id: true },
    }))!.id

  const cSolicitar = await passoDe("solicitar")
  const cAguardar = await passoDe("aguardar")
  const antesCiclo = await fotografar(proc.id)

  const rCiclo = await executarReabertura({
    stepInstanceId: cSolicitar, motivoCodigo: "ERRO_OPERACIONAL",
    justificativa: "Refazer o pedido e o que depende dele.", comDependentes: true, actorId: actor.id,
  })
  check("a etapa é reaberta", rCiclo.ok, JSON.stringify(rCiclo))
  const depoisReabrir = await prisma.phaseWorkflowStepInstance.findMany({
    where: { id: { in: [cSolicitar, cAguardar] } }, select: { id: true, status: true },
  })
  check("  a reaberta volta a executar", depoisReabrir.find((x) => x.id === cSolicitar)?.status === "EM_ANDAMENTO")
  check("  e o dependente fica AGUARDANDO a dependência",
    depoisReabrir.find((x) => x.id === cAguardar)?.status === "BLOQUEADO")

  // O DEPENDENTE NÃO ANDA ENQUANTO A DEPENDÊNCIA ESTIVER ABERTA.
  const { transicionarPassoTx, concluirPasso } = await import("../src/services/task-step-sync")
  const inst2 = (await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: cAguardar }, select: { workflowInstanceId: true },
  }))!.workflowInstanceId
  const tentaAndar = await prisma.$transaction((tx) =>
    transicionarPassoTx(tx, cAguardar, "EM_ANDAMENTO", {
      correlationId: `${M}-ciclo-dep`, operacao: "teste", ciclo: 1, processoId: proc.id, workflowInstanceId: inst2,
    }))
  check("  o dependente é RECUSADO enquanto a dependência não fecha",
    !tentaAndar.changed && tentaAndar.code === "DEPENDENCIA_PENDENTE", JSON.stringify(tentaAndar))

  // EXECUTAR DE NOVO E CONCLUIR.
  const rConcluir = await concluirPasso(cSolicitar, { origem: "USER", correlationId: `${M}-ciclo-concluir` })
  check("a etapa reaberta conclui de novo", rConcluir.success && rConcluir.changed, JSON.stringify(rConcluir).slice(0, 160))
  const aguardarDepois = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: cAguardar }, select: { status: true },
  })
  check("  e o dependente é LIBERADO pela dependência cumprida",
    aguardarDepois?.status === "DISPONIVEL", String(aguardarDepois?.status))

  const rDep = await concluirPasso(cAguardar, { origem: "USER", correlationId: `${M}-ciclo-dep-concluir` })
  check("  o dependente conclui na sequência", rDep.success && rDep.changed)

  const tCiclo = await tentativasDoPasso(cSolicitar)
  check("a execução ANTERIOR continua inteira ao lado da nova",
    tCiclo.length === 2 && tCiclo[0].supersededAt != null && tCiclo[0].completedAt != null &&
    tCiclo[1].supersededAt == null && tCiclo[1].completedAt != null,
    JSON.stringify(tCiclo.map((t) => ({ seq: t.sequencia, st: t.status, fim: !!t.completedAt, arq: !!t.supersededAt }))))
  check("  e as duas têm identidades diferentes", tCiclo[0].id !== tCiclo[1].id)

  // NADA FORA DA UNIDADE FOI TOCADO PELO CICLO INTEIRO.
  const depoisCiclo = await fotografar(proc.id)
  const foraDaUnidade = depoisCiclo.passos.filter((d) => {
    if (d.documentoId === cicloDoc) return false
    const a = antesCiclo.passos.find((x) => x.id === d.id)
    return !a || a.status !== d.status || a.completedAt?.toISOString() !== d.completedAt?.toISOString()
  })
  check("o ciclo completo não tocou nenhuma outra unidade", foraDaUnidade.length === 0,
    JSON.stringify(foraDaUnidade.slice(0, 4).map((x) => [x.stepKey, x.documentoId, x.status])))

  // ══════════════════════════════════════════════════════════════
  secao("TESTE 8 — idempotência: reconciliar, recarregar e navegar não duplicam")
  // ══════════════════════════════════════════════════════════════
  //
  // O usuário abre a tela, o cron passa, alguém dá F5. Nada disso é um comando — e
  // nada disso pode criar instância, tarefa, execução ou obrigação.
  // A PRIMEIRA PASSAGEM CONVERGE; a idempotência é sobre as SEGUINTES.
  //
  // Este palco monta as 250 instâncias direto no banco, sem passar pela projeção de
  // tarefa — então a primeira reconciliação legitimamente materializa o que faltava.
  // Confundir convergência com duplicação reprovaria o reconciliador por fazer o
  // trabalho dele. O que se cobra é: S1 → reconcile → S1.
  const { reconciliarTarefas } = await import("../lib/operacional/reconciliar-tarefas")
  const { reconciliarMotorDeFases } = await import("../src/lib/motor/reconciliar-motor-fases")
  await reconciliarTarefas({ processoId: proc.id }).catch(() => null)
  await reconciliarMotorDeFases(proc.id, { origem: "teste-idem", correlationId: `${M}-idem-warm` }).catch(() => null)

  const antesIdem = await fotografar(proc.id)
  const tarefasAntes = await prisma.tarefa.count({ where: { processoId: proc.id } })
  console.log(`      estado estável: ${antesIdem.passos.length} instâncias · ${antesIdem.execs.length} execuções · ${tarefasAntes} tarefas`)

  for (let i = 0; i < 5; i++) {
    await reconciliarTarefas({ processoId: proc.id }).catch(() => null)
    await reconciliarMotorDeFases(proc.id, { origem: "teste-idem", correlationId: `${M}-idem-${i}` }).catch(() => null)
    // "Recarregar a tela" é ler o plano — leitura pura, repetida.
    await planejarReabertura(cSolicitar)
  }
  const depoisIdem = await fotografar(proc.id)
  check("a partir do estado estável, 5 reconciliações + 5 leituras não criam instância",
    depoisIdem.passos.length === antesIdem.passos.length,
    `${antesIdem.passos.length} → ${depoisIdem.passos.length}`)
  check("  nem execução", depoisIdem.execs.length === antesIdem.execs.length,
    `${antesIdem.execs.length} → ${depoisIdem.execs.length}`)
  check("  nem tarefa", (await prisma.tarefa.count({ where: { processoId: proc.id } })) === tarefasAntes)
  check("  e não mudaram nenhum estado válido",
    JSON.stringify(depoisIdem.passos) === JSON.stringify(antesIdem.passos))
  const duplicadas = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int n FROM (SELECT "stepInstanceId" FROM "StepExecution" WHERE "supersededAt" IS NULL GROUP BY 1 HAVING COUNT(*)>1) x`)
  check("  nenhuma etapa ficou com duas execuções vigentes", duplicadas[0].n === 0)

  await limpar()
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) for (const f of falhas) console.log(`  · ${f}`)
  await prisma.$disconnect()
  process.exit(falhas.length ? 1 : 0)
}

/** A execução pertence a uma instância do documento alvo? */
function idsDoAlvoOuDoc(
  stepInstanceId: number,
  passos: Array<{ id: number; documentoId: number | null }>,
  docs: Set<number | null>,
): boolean {
  const p = passos.find((x) => x.id === stepInstanceId)
  return !!p && docs.has(p.documentoId)
}

void main()
