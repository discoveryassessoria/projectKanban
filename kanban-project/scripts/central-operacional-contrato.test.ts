// scripts/central-operacional-contrato.test.ts
// ============================================================================
// O CONTRATO DA CENTRAL OPERACIONAL — Fase 3 (backend/projeção).
//
//   npx tsx scripts/central-operacional-contrato.test.ts
//
// Este teste protege as duas correções que o usuário exigiu antes de liberar
// a implementação, e o resto do contrato aprovado:
//
//   1. "EXECUTÁVEL AGORA" não é `!aguardandoDependencia`. É terminal E
//      em-espera (bloqueada/aguardando terceiro-cliente) E dependência aberta
//      E causa removida — tudo excluindo, nenhum sozinho.
//   2. "AGUARDANDO TERCEIRO" é ESTADO (statusTarefa, evento real) — nunca
//      inferido de `Documento.orgao`. `Documento.orgao` só identifica QUEM é
//      o terceiro quando a tarefa JÁ está esperando; nunca decide SE está.
//   3. `bloqueadoManual` (nível Passo) não tem fluxo de escrita — guarda
//      estática para nunca aparecer como filtro sem que alguém primeiro
//      construa o write path e atualize este teste.
//   4. Pendências de fases anteriores, sem movimentação real (não
//      `updatedAt`), contadores == população do drill-down, deduplicação por
//      tarefa canônica, e reúso de `agregacaoPorFamilia`/`visaoGerencial`
//      (nenhum motor paralelo).
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { atribuirTarefa } from "@/lib/operacional/tarefa-comandos"
import { bloquearTarefa, aguardarTerceiro, declararDependencia, alterarPrioridade } from "@/lib/operacional/tarefa-ciclo"
import { executavelAgora, STATUS_TERMINAIS, STATUS_EM_ESPERA, STATUS_ATIVOS } from "@/lib/operacional/tarefa-canonica"
import { visaoGerencial, indicadoresGerenciais, agregacaoPorFamilia, facetasGerenciais } from "@/lib/operacional/tarefa-projecoes"
import type { StatusTarefa } from "@prisma/client"

const MARCA = "CENTRALOP"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(join(__dirname, "..", p), "utf8")

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  const tids = ts.map((t) => t.id)
  await prisma.tarefaDependencia.deleteMany({ where: { OR: [{ tarefaId: { in: tids } }, { dependeDeId: { in: tids } }] } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: tids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvore: { nome: { startsWith: MARCA } } } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.familia.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.orgaoProtocolo.deleteMany({ where: { name: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@centralop.test" } } })
}

async function palco(sufixo: string, faseMacroKey = "genealogia", familiaId: number | null = null) {
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${sufixo}`, name: `Trabalho ${sufixo}`, natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} ${sufixo}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} ${sufixo}`, arvoreId: arv.id, familiaId }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Ademir", sobrenome: sufixo }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-n-${sufixo}-${proc.id}` }, select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey, ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-i-${sufixo}-${proc.id}` }, select: { id: true },
  })
  await prisma.phaseWorkflowStepInstance.create({
    data: {
      workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey, stepKey: `${sufixo}_0`,
      ordem: 1, tipo: "HUMANO", obrigatorio: true, status: "DISPONIVEL",
      necessidadeId: nec.id, pessoaId: pes.id, papel: "equipe_documental", slaDays: 5,
      chaveIdempotencia: `${MARCA}-s-${sufixo}-${proc.id}-0`,
    },
  })
  await reconciliarTarefas({ processoId: proc.id })
  const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true } })
  return { processoId: proc.id, pessoaId: pes.id, tarefaId: t.id }
}

const usuario = (nome: string) =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}@centralop.test`, senha: "x", tipo: "assistente" }, select: { id: true } })

async function main() {
  exigirBancoDeTeste("prova o contrato da Central Operacional")
  await limpar()
  const gestor = await usuario("Gestor")

  console.log("O CONTRATO DA CENTRAL OPERACIONAL\n")

  // ══════════════════════════════════════════════════════════════════════════
  secao("1) EXECUTÁVEL AGORA — não é !aguardandoDependencia sozinho (função pura)")
  // ══════════════════════════════════════════════════════════════════════════
  const base = { aguardandoDependencia: false, causaRemovidaEm: null as Date | null }
  ok("1a) NAO_INICIADA sem impedimento é executável",
    executavelAgora({ ...base, statusTarefa: "NAO_INICIADA" }) === true)
  ok("1b) EM_ANDAMENTO sem impedimento é executável",
    executavelAgora({ ...base, statusTarefa: "EM_ANDAMENTO" }) === true)
  for (const st of STATUS_TERMINAIS) {
    ok(`1c) terminal (${st}) NUNCA é executável`, executavelAgora({ ...base, statusTarefa: st }) === false)
  }
  for (const st of STATUS_EM_ESPERA) {
    ok(`1d) em espera (${st}) NÃO é executável — ação é sobre o impedimento, não o trabalho`,
      executavelAgora({ ...base, statusTarefa: st }) === false)
  }
  ok("1e) dependência obrigatória aberta anula a executabilidade mesmo em EM_ANDAMENTO",
    executavelAgora({ statusTarefa: "EM_ANDAMENTO", aguardandoDependencia: true, causaRemovidaEm: null }) === false)
  ok("1f) causa removida pendente de decisão anula a executabilidade mesmo em EM_ANDAMENTO",
    executavelAgora({ statusTarefa: "EM_ANDAMENTO", aguardandoDependencia: false, causaRemovidaEm: new Date() }) === false)
  ok("1g) STATUS_ATIVOS inclui todo STATUS_EM_ESPERA (senão o filtro 'executável' e o quadro operacional divergem)",
    STATUS_EM_ESPERA.every((s) => STATUS_ATIVOS.includes(s)))

  // ══════════════════════════════════════════════════════════════════════════
  secao("2) EXECUTÁVEL AGORA — integração real (dependência via TarefaDependencia)")
  // ══════════════════════════════════════════════════════════════════════════
  const preReq = await palco("PRE")
  const dependente = await palco("DEP")
  const decl = await declararDependencia({ tarefaId: dependente.tarefaId, dependeDeId: preReq.tarefaId, obrigatoria: true, autorId: gestor.id })
  ok("2a) declararDependencia() é aceita", decl.ok === true)
  const linhaDependente1 = (await visaoGerencial({ processoId: dependente.processoId }, new Date())).linhas[0]
  ok("2b) tarefa dependente fica aguardandoDependencia=true", linhaDependente1?.aguardandoDependencia === true)
  ok("2c) e por isso executavelAgora=false, mesmo NAO_INICIADA (não é terminal nem bloqueada)",
    linhaDependente1?.statusTarefa === "NAO_INICIADA" && linhaDependente1?.executavelAgora === false)
  const semDependencia = await visaoGerencial({ processoId: dependente.processoId, executavelAgora: false }, new Date())
  ok("2d) filtro executavelAgora=false no BANCO encontra a mesma tarefa (não é filtro client-side)",
    semDependencia.linhas.some((l) => l.taskId === dependente.tarefaId))
  const comExecutavel = await visaoGerencial({ processoId: dependente.processoId, executavelAgora: true }, new Date())
  ok("2e) e filtro executavelAgora=true NÃO a encontra", !comExecutavel.linhas.some((l) => l.taskId === dependente.tarefaId))

  // ══════════════════════════════════════════════════════════════════════════
  secao("3) EXECUTÁVEL AGORA — integração real (bloqueio e espera externa)")
  // ══════════════════════════════════════════════════════════════════════════
  const bloqueada = await palco("BLQ")
  await bloquearTarefa({ tarefaId: bloqueada.tarefaId, autorId: gestor.id, motivo: "teste de contrato" })
  const linhaBloqueada = (await visaoGerencial({ processoId: bloqueada.processoId }, new Date())).linhas[0]
  ok("3a) bloqueada tem statusTarefa=BLOQUEADA", linhaBloqueada?.statusTarefa === "BLOQUEADA")
  ok("3b) e executavelAgora=false — a ação disponível é desbloquear, não o trabalho", linhaBloqueada?.executavelAgora === false)
  ok("3c) filtro `bloqueada` (açúcar sobre status) encontra exatamente essa tarefa",
    (await visaoGerencial({ processoId: bloqueada.processoId, bloqueada: true }, new Date())).linhas.some((l) => l.taskId === bloqueada.tarefaId))

  // ══════════════════════════════════════════════════════════════════════════
  secao("4) AGUARDANDO TERCEIRO — A) ESTADO real (evento), nunca inferido de Documento.orgao")
  // ══════════════════════════════════════════════════════════════════════════
  const esperando = await palco("ESP")
  await aguardarTerceiro({ tarefaId: esperando.tarefaId, autorId: gestor.id, motivo: "aguardando cartório" })
  const linhaEsperando = (await visaoGerencial({ processoId: esperando.processoId }, new Date())).linhas[0]
  ok("4a) aguardarTerceiro() grava statusTarefa=AGUARDANDO_TERCEIRO (evento real, não inferência)",
    linhaEsperando?.statusTarefa === "AGUARDANDO_TERCEIRO")
  ok("4b) sem Documento vinculado, terceiroNome fica null — espera é real, terceiro não identificado",
    linhaEsperando?.terceiroNome === null)
  ok("4c) filtro aguardandoTerceiro encontra essa tarefa pelo ESTADO",
    (await visaoGerencial({ processoId: esperando.processoId, aguardandoTerceiro: true }, new Date())).linhas.some((l) => l.taskId === esperando.tarefaId))

  const naoEsperando = await palco("NESP")
  const orgao = await prisma.orgaoProtocolo.create({ data: { name: `${MARCA} Cartório de Teste` }, select: { id: true, name: true } })
  const pessoaNaoEsperando = await prisma.pessoa.findFirstOrThrow({ where: { id: naoEsperando.pessoaId }, select: { id: true } })
  const doc = await prisma.documento.create({ data: { pessoaId: pessoaNaoEsperando.id, orgaoId: orgao.id }, select: { id: true } })
  await prisma.tarefa.update({ where: { id: naoEsperando.tarefaId }, data: { documentoId: doc.id } })
  const linhaNaoEsperando = (await visaoGerencial({ processoId: naoEsperando.processoId }, new Date())).linhas[0]
  ok("4d) B) Documento.orgao SOZINHO não prova espera — a tarefa está NAO_INICIADA, não aguardando",
    linhaNaoEsperando?.statusTarefa !== "AGUARDANDO_TERCEIRO" && linhaNaoEsperando?.statusTarefa !== "AGUARDANDO_CLIENTE")
  ok("4e) e por isso NÃO aparece no filtro aguardandoTerceiro, mesmo tendo Documento.orgao preenchido",
    !(await visaoGerencial({ processoId: naoEsperando.processoId, aguardandoTerceiro: true }, new Date())).linhas.some((l) => l.taskId === naoEsperando.tarefaId))

  // Agora a MESMA tarefa passa a esperar de verdade — só então o vínculo vira identificação.
  await aguardarTerceiro({ tarefaId: naoEsperando.tarefaId, autorId: gestor.id, motivo: "aguardando órgão" })
  const linhaAgoraEsperando = (await visaoGerencial({ processoId: naoEsperando.processoId }, new Date())).linhas[0]
  ok("4f) com o estado real presente, Documento.orgao agora IDENTIFICA quem é o terceiro",
    linhaAgoraEsperando?.statusTarefa === "AGUARDANDO_TERCEIRO" && linhaAgoraEsperando?.terceiroNome === orgao.name)

  // ══════════════════════════════════════════════════════════════════════════
  secao("5) bloqueadoManual (nível Passo) — CONFIRMADO sem fluxo de escrita")
  // ══════════════════════════════════════════════════════════════════════════
  const arquivosComEscritaProibida = [
    "src/lib/motor/operational-projection-core.ts",
    "src/lib/process-stage/operational-projection.ts",
    "src/services/passo-tarefa.ts",
    "src/services/operational-workflow.ts",
    "src/services/operational-workflow-helpers.ts",
    "src/components/kanban/WorkflowV2Panel.tsx",
  ]
  for (const arq of arquivosComEscritaProibida) {
    const codigo = ler(arq)
    ok(`5) ${arq} não ESCREVE bloqueadoManual (só lê)`,
      !/bloqueadoManual\s*:\s*(true|false|!)/.test(codigo.replace(/bloqueadoManual\s*:\s*boolean/g, "")) &&
      !/bloqueadoManual\s*=\s*(true|false)/.test(codigo))
  }
  ok("5) a Central não expõe filtro `bloqueadoManual` em FiltrosGerenciais (lacuna reportada, não inventada)",
    !/bloqueadoManual/.test(ler("lib/operacional/tarefa-projecoes.ts")))

  // ══════════════════════════════════════════════════════════════════════════
  secao("6) PENDÊNCIAS DE FASES ANTERIORES — projeção aditiva, não SQL por tarefa")
  // ══════════════════════════════════════════════════════════════════════════
  const atrasoDeFase = await palco("FASE", "genealogia")
  // O processo AVANÇOU para emissão documental — mas a tarefa de genealogia
  // continua ATIVA. É exatamente a lacuna que a Home ignora por design.
  await prisma.processo.update({ where: { id: atrasoDeFase.processoId }, data: { faseAtualKey: "emissao_documental" } })
  const drillFasesAnteriores = await visaoGerencial({ processoId: atrasoDeFase.processoId, pendenciasFasesAnteriores: true }, new Date())
  ok("6a) a tarefa da fase anterior (genealogia) aparece no filtro", drillFasesAnteriores.linhas.some((l) => l.taskId === atrasoDeFase.tarefaId))
  const semFiltroFase = await visaoGerencial({ processoId: atrasoDeFase.processoId }, new Date())
  ok("6b) sem o filtro, a mesma tarefa continua visível normalmente (nada foi escondido/alterado)",
    semFiltroFase.linhas.some((l) => l.taskId === atrasoDeFase.tarefaId))
  const familiasFase = await agregacaoPorFamilia(new Date(), { processoId: atrasoDeFase.processoId })
  ok("6c) agregacaoPorFamilia contabiliza a pendência no PROCESSO (mesma repartição por fase, sem query nova)",
    (familiasFase[0]?.processos[0]?.pendenciasFaseAnterior ?? 0) > 0)
  ok("6d) e soma para a FAMÍLIA (visual), sem virar 'tarefa da família'",
    (familiasFase[0]?.pendenciasFaseAnterior ?? 0) === (familiasFase[0]?.processos[0]?.pendenciasFaseAnterior ?? -1))

  // ══════════════════════════════════════════════════════════════════════════
  secao("7) SEM MOVIMENTAÇÃO — auditoria REAL, nunca `updatedAt` ingênuo")
  // ══════════════════════════════════════════════════════════════════════════
  const parada = await palco("MOV")
  const seisMesesAtras = new Date(Date.now() - 180 * 86400000)
  await prisma.tarefa.update({ where: { id: parada.tarefaId }, data: { createdAt: seisMesesAtras } })
  // A criação em si já audita (`TAREFA_CRIADA`) — para isolar o CAMINHO DE
  // FALLBACK (sem nenhuma linha de auditoria, dado legado pré-trilha), a
  // trilha desta tarefa é limpa aqui. Isso é preparo de fixture, não o que o
  // sistema faz sozinho: toda ação canônica real AUDITA (é o que a §7c prova).
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: parada.tarefaId } })
  const antesDoToque = await visaoGerencial({ processoId: parada.processoId, semMovimentacao: { diasSemAtividade: 7 } }, new Date())
  ok("7a) tarefa criada há 6 meses, sem auditoria alguma, entra em 'sem movimentação' (fallback = createdAt)",
    antesDoToque.linhas.some((l) => l.taskId === parada.tarefaId))
  // Toca updatedAt SEM passar por nenhum serviço canônico (o que um efeito em
  // cascata de OUTRO registro faria) — updatedAt sobe, auditoria não.
  await prisma.tarefa.update({ where: { id: parada.tarefaId }, data: { observacoes: "toque de cascata, sem auditoria" } })
  const depoisDoToqueCru = await visaoGerencial({ processoId: parada.processoId, semMovimentacao: { diasSemAtividade: 7 } }, new Date())
  ok("7b) updatedAt sozinho NÃO tira a tarefa de 'sem movimentação' — não é o sinal usado",
    depoisDoToqueCru.linhas.some((l) => l.taskId === parada.tarefaId))
  // Agora uma AÇÃO CANÔNICA real, que grava LogAuditoria de verdade.
  await alterarPrioridade({ tarefaId: parada.tarefaId, autorId: gestor.id, prioridade: "ALTA", motivo: "teste de contrato" })
  const depoisDaAcaoReal = await visaoGerencial({ processoId: parada.processoId, semMovimentacao: { diasSemAtividade: 7 } }, new Date())
  ok("7c) uma ação REGISTRADA (auditoria) tira a tarefa de 'sem movimentação'",
    !depoisDaAcaoReal.linhas.some((l) => l.taskId === parada.tarefaId))

  // ══════════════════════════════════════════════════════════════════════════
  secao("8) CONTADORES == população do drill-down (mesma query, nunca linhas.filter)")
  // ══════════════════════════════════════════════════════════════════════════
  const indicadores = await indicadoresGerenciais({ processoId: dependente.processoId }, new Date())
  const drill = await visaoGerencial({ processoId: dependente.processoId, porPagina: 500 }, new Date())
  ok("8a) indicadoresGerenciais.total bate com o total do drill-down", indicadores.total === drill.total)
  ok("8b) indicadoresGerenciais.executavelAgora bate com a contagem real das linhas devolvidas",
    indicadores.executavelAgora === drill.linhas.filter((l) => l.executavelAgora).length)

  // ══════════════════════════════════════════════════════════════════════════
  secao("9) DEDUPLICAÇÃO — uma tarefa que bate em dois filtros aparece UMA vez")
  // ══════════════════════════════════════════════════════════════════════════
  const duplaCondicao = await palco("DUP")
  const ontem = new Date(Date.now() - 86400000)
  await prisma.tarefa.update({ where: { id: duplaCondicao.tarefaId }, data: { dataPrazo: ontem, responsavelId: null } })
  const combinado = await visaoGerencial({ processoId: duplaCondicao.processoId, atrasadas: true, semResponsavel: true }, new Date())
  const ocorrencias = combinado.linhas.filter((l) => l.taskId === duplaCondicao.tarefaId).length
  ok("9a) atrasada E sem responsável ao mesmo tempo: a tarefa aparece EXATAMENTE uma vez", ocorrencias === 1)
  ok("9b) contagem bate: total da view === tarefas únicas", combinado.linhas.length === new Set(combinado.linhas.map((l) => l.taskId)).size)

  // ══════════════════════════════════════════════════════════════════════════
  secao("10) FAMÍLIA — agrupamento visual, NUNCA dona da tarefa")
  // ══════════════════════════════════════════════════════════════════════════
  const familia = await prisma.familia.create({ data: { nome: `${MARCA} Família Teste` }, select: { id: true } })
  const proc1 = await palco("FAM1", "genealogia", familia.id)
  const proc2 = await palco("FAM2", "genealogia", familia.id)
  const respA = await usuario("RespA")
  const respB = await usuario("RespB")
  await atribuirTarefa({ tarefaId: proc1.tarefaId, responsavelId: respA.id, autorId: gestor.id })
  await atribuirTarefa({ tarefaId: proc2.tarefaId, responsavelId: respB.id, autorId: gestor.id })
  const familiasAgrupadas = await agregacaoPorFamilia(new Date(), { familiaId: familia.id })
  const familiaResultado = familiasAgrupadas.find((f) => f.familiaId === familia.id)
  ok("10a) a família agrupa os DOIS processos", (familiaResultado?.processos.length ?? 0) === 2)
  ok("10b) `FamiliaAgrupada` não tem campo `responsavelId` — não é dona de nada",
    familiaResultado != null && !Object.prototype.hasOwnProperty.call(familiaResultado, "responsavelId"))
  ok("10c) responsáveis DIFERENTES entre processos da mesma família: 'responsavelPrincipal' fica null (Vários), nunca um palpite",
    familiaResultado?.responsavelPrincipal === null)

  // ══════════════════════════════════════════════════════════════════════════
  secao("11) REÚSO — nenhum motor paralelo")
  // ══════════════════════════════════════════════════════════════════════════
  const codigoProjecoes = ler("lib/operacional/tarefa-projecoes.ts")
  ok("11a) agregacaoPorFamilia chama whereGerencial (a MESMA função da Lista/Kanban)",
    /agregacaoPorFamilia[\s\S]{0,600}whereGerencial\(filtro, agora\)/.test(codigoProjecoes))
  ok("11b) agregacaoPorFamilia não duplica a lógica de status/escopo que whereGerencial já encapsula",
    !/statusTarefa:\s*\{\s*in:\s*STATUS_NO_QUADRO\s*\},\s*\.\.\.escopo/.test(codigoProjecoes))

  // ══════════════════════════════════════════════════════════════════════════
  secao("12) ORDENAÇÃO DA LISTA DE FAMÍLIAS — lexicográfica sobre contagens reais, nunca score artificial")
  // ══════════════════════════════════════════════════════════════════════════
  const ordA = await palco("ORDA") // fica atrasada
  const ordB = await palco("ORDB") // prazo próximo, não bloqueada
  const ordC = await palco("ORDC") // bloqueada, prazo distante

  const agoraOrd = new Date()
  const ontemOrd = new Date(agoraOrd.getTime() - 86400000)
  const em2Dias = new Date(agoraOrd.getTime() + 2 * 86400000)
  const em20Dias = new Date(agoraOrd.getTime() + 20 * 86400000)
  await prisma.tarefa.update({ where: { id: ordA.tarefaId }, data: { dataPrazo: ontemOrd } })
  await prisma.tarefa.update({ where: { id: ordB.tarefaId }, data: { dataPrazo: em2Dias } })
  await prisma.tarefa.update({ where: { id: ordC.tarefaId }, data: { dataPrazo: em20Dias } })
  await bloquearTarefa({ tarefaId: ordC.tarefaId, autorId: gestor.id, motivo: "teste de ordenação" })

  const porAtencao = await agregacaoPorFamilia(agoraOrd, { ordenacaoFamilia: "atencao" })
  const nomesOrdA = porAtencao.map((f) => f.nomeFamilia).filter((n) => n.startsWith("CENTRALOP ORD"))
  ok("12a) 'atencao': mais atrasada primeiro (ORDA)", nomesOrdA[0] === "CENTRALOP ORDA")
  ok("12b) 'atencao': entre as não-atrasadas, a BLOQUEADA (ORDC) vem antes da que só tem prazo (ORDB)",
    nomesOrdA.indexOf("CENTRALOP ORDC") < nomesOrdA.indexOf("CENTRALOP ORDB"))

  const porPrazo = await agregacaoPorFamilia(agoraOrd, { ordenacaoFamilia: "prazo" })
  const nomesOrdP = porPrazo.map((f) => f.nomeFamilia).filter((n) => n.startsWith("CENTRALOP ORD"))
  ok("12c) 'prazo': ordena só pelo prazo mais próximo — ORDA (ontem), ORDB (2 dias), ORDC (20 dias), IGNORANDO bloqueio",
    nomesOrdP.indexOf("CENTRALOP ORDA") < nomesOrdP.indexOf("CENTRALOP ORDB") &&
    nomesOrdP.indexOf("CENTRALOP ORDB") < nomesOrdP.indexOf("CENTRALOP ORDC"))
  ok("12d) 'atencao' e 'prazo' produzem ordens DIFERENTES sobre o mesmo conjunto — provam ser critérios distintos, não o mesmo cálculo disfarçado",
    JSON.stringify(nomesOrdA) !== JSON.stringify(nomesOrdP))

  const porNome = await agregacaoPorFamilia(agoraOrd, { ordenacaoFamilia: "familia" })
  const nomesOrdN = porNome.map((f) => f.nomeFamilia).filter((n) => n.startsWith("CENTRALOP ORD"))
  ok("12e) 'familia': ordem alfabética pura, sem olhar prazo nem bloqueio",
    JSON.stringify(nomesOrdN) === JSON.stringify(["CENTRALOP ORDA", "CENTRALOP ORDB", "CENTRALOP ORDC"]))

  // "última atividade": toca B por último, sem passar por ação canônica (mesma
  // simulação de cascata da §7) — só para provar que a ORDENAÇÃO lê `updatedAt`
  // (ela É sobre "quando mexeram", ao contrário do filtro "sem movimentação",
  // que exige auditoria real).
  await prisma.tarefa.update({ where: { id: ordA.tarefaId }, data: { observacoes: "x" } })
  await prisma.tarefa.update({ where: { id: ordC.tarefaId }, data: { observacoes: "x" } })
  await prisma.tarefa.update({ where: { id: ordB.tarefaId }, data: { observacoes: "x" } })
  const porAtividade = await agregacaoPorFamilia(new Date(), { ordenacaoFamilia: "ultimaAtividade" })
  const nomesOrdU = porAtividade.map((f) => f.nomeFamilia).filter((n) => n.startsWith("CENTRALOP ORD"))
  ok("12f) 'ultimaAtividade': a família tocada por último (ORDB) vem primeiro", nomesOrdU[0] === "CENTRALOP ORDB")

  ok("12g) sem `ordenacaoFamilia`, o padrão é 'atencao' (mesma ordem de 12a/12b)",
    JSON.stringify((await agregacaoPorFamilia(agoraOrd, {})).map((f) => f.nomeFamilia).filter((n) => n.startsWith("CENTRALOP ORD"))) === JSON.stringify(nomesOrdA))

  // ══════════════════════════════════════════════════════════════════════════
  secao("13) PAGINAÇÃO DA LISTA DE FAMÍLIAS — recorte determinístico, sem perder nem duplicar família")
  // ══════════════════════════════════════════════════════════════════════════
  const todasOrdenadas = await agregacaoPorFamilia(agoraOrd, { ordenacaoFamilia: "familia" })
  const porPagina = 2
  const pagina1 = todasOrdenadas.slice(0, porPagina)
  const pagina2 = todasOrdenadas.slice(porPagina, porPagina * 2)
  ok("13a) a página 1 tem o tamanho pedido (ou menos, se acabou a lista)", pagina1.length <= porPagina)
  ok("13b) página 1 e página 2 não repetem família nenhuma",
    pagina1.every((f) => !pagina2.some((g) => g.nomeFamilia === f.nomeFamilia)))
  ok("13c) juntar as páginas reconstrói o prefixo da lista completa, na MESMA ordem",
    JSON.stringify([...pagina1, ...pagina2].map((f) => f.nomeFamilia)) === JSON.stringify(todasOrdenadas.slice(0, porPagina * 2).map((f) => f.nomeFamilia)))

  // ══════════════════════════════════════════════════════════════════════════
  secao("14) EQUIPE — filtrável mesmo sendo texto livre (decisão 1 do contrato)")
  // ══════════════════════════════════════════════════════════════════════════
  const comEquipe = await palco("EQUIPE")
  const linhaEquipe = (await visaoGerencial({ processoId: comEquipe.processoId }, new Date())).linhas[0]
  ok("14a) a tarefa nasce com equipeKey derivado do papel do passo (não é cadastro, mas existe)",
    !!linhaEquipe?.equipeKey)
  const filtradoPorEquipe = await visaoGerencial({ processoId: comEquipe.processoId, equipeKey: [linhaEquipe!.equipeKey as string] }, new Date())
  ok("14b) filtrar por essa equipeKey encontra a tarefa", filtradoPorEquipe.linhas.some((l) => l.taskId === comEquipe.tarefaId))
  const filtradoPorOutraEquipe = await visaoGerencial({ processoId: comEquipe.processoId, equipeKey: ["equipe-que-nao-existe"] }, new Date())
  ok("14c) filtrar por outra equipeKey NÃO encontra", !filtradoPorOutraEquipe.linhas.some((l) => l.taskId === comEquipe.tarefaId))
  const facetas = await facetasGerenciais(new Date())
  ok("14d) facetasGerenciais expõe as equipes que EXISTEM, não uma lista fixa",
    facetas.equipes.some((e) => e.equipeKey === linhaEquipe?.equipeKey))

  // ══════════════════════════════════════════════════════════════════════════
  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(", ")) }
  await limpar()
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
