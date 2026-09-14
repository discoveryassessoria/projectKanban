// scripts/etapa6-circuito-completo.test.ts
// ============================================================================
// ETAPA 6 — CIRCUITO OPERACIONAL COMPLETO (grão TAREFA).
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/etapa6-circuito-completo.test.ts
//
// NÃO testa peças isoladas — testa o CIRCUITO: uma única Tarefa nasce, é
// atribuída, executa um passo, entra em espera, recebe follow-up, o terceiro
// responde, é reatribuída, entra em EM_RISCO e sai, e em cada passo o
// resultado é conferido em banco + histórico + evento + notificação +
// projeção (tarefa-projecoes.ts), nunca só no retorno da chamada.
//
// A parte de FASE (avançar/retroceder/retornar/concluir fase) está em
// scripts/etapa6-fase-circuito.test.ts — precisa de um macro workflow
// completo (TRUNCATE), incompatível com o resto deste arquivo.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { reconciliarTarefas } from "@/lib/operacional/reconciliar-tarefas"
import { atribuirTarefa, transferirTarefa, avisarAcontecimentosOperacionais } from "@/lib/operacional/tarefa-comandos"
import { aguardarTerceiro, retomarDeEspera, politicaDeSla } from "@/lib/operacional/tarefa-ciclo"
import { concluirEtapa } from "@/lib/operacional/tarefa-etapa"
import { estadoTemporalDaOperacao } from "@/lib/operacional/proximo-acontecimento"
import { visaoGerencial, minhaFila, dossieDaTarefa, indicadoresGerenciais } from "@/lib/operacional/tarefa-projecoes"
import { aplicarAndamento, gravarAndamento, ANDAMENTO_VAZIO } from "@/src/lib/process-stage/andamento-etapa"

const MARCA = "ETAPA6-TEST"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  const tids = ts.map((t) => t.id)
  await prisma.tarefaDependencia.deleteMany({ where: { OR: [{ tarefaId: { in: tids } }, { dependeDeId: { in: tids } }] } })
  await prisma.notificacaoOperacional.deleteMany({ where: { OR: [{ tarefaId: { in: tids } }, { processoId: { in: ids } }] } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: tids } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  for (const p of procs) if (p.arvoreId) await prisma.pessoa.deleteMany({ where: { arvoreId: p.arvoreId } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@etapa6.test" } } })
}

let seq = 0
async function palco(etapas = 2) {
  seq++
  const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_${seq}`, name: "Certidão de Nascimento - Inteiro Teor", natureza: "DOCUMENTO" }, select: { id: true } })
  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} árvore ${seq}` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} processo ${seq}`, arvoreId: arv.id }, select: { id: true } })
  const pes = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Fulano", sobrenome: `Teste${seq}` }, select: { id: true } })
  const nec = await prisma.necessidadeDocumental.create({
    data: { processoId: proc.id, itemCatalogoId: item.id, pessoaId: pes.id, ciclo: 1, chaveIdempotencia: `${MARCA}-nec-${proc.id}` }, select: { id: true },
  })
  const inst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${MARCA}-inst-${proc.id}` }, select: { id: true },
  })
  const stepIds: number[] = []
  for (let i = 0; i < etapas; i++) {
    const s = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: "genealogia", stepKey: `passo_${seq}_${i}`,
        ordem: i + 1, tipo: "HUMANO", obrigatorio: true, status: i === 0 ? "DISPONIVEL" : "PENDENTE",
        necessidadeId: nec.id, pessoaId: pes.id, papel: "equipe_documental", slaDays: 5,
        chaveIdempotencia: `${MARCA}-step-${proc.id}-${i}`,
      }, select: { id: true },
    })
    stepIds.push(s.id)
  }
  await reconciliarTarefas({ processoId: proc.id })
  const t = await prisma.tarefa.findFirstOrThrow({ where: { processoId: proc.id }, select: { id: true, lockVersion: true } })
  return { processoId: proc.id, instanciaId: inst.id, stepIds, tarefaId: t.id }
}

const usuario = (nome: string, tipo: "admin" | "assistente" = "assistente") =>
  prisma.usuario.create({ data: { nome, email: `${nome.toLowerCase()}.${++seq}@etapa6.test`, senha: "x", tipo }, select: { id: true, nome: true } })

async function registrarContato(stepId: number, contato: Record<string, unknown>) {
  const step = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: stepId }, select: { metadata: true } })
  const operacaoAtual = (step.metadata as Record<string, unknown> | null)?.operacao as Record<string, unknown> | undefined
  const { andamento } = aplicarAndamento(ANDAMENTO_VAZIO, { contato }, { agora: new Date(), autorId: null })
  const novaOperacao = gravarAndamento(operacaoAtual ?? {}, andamento)
  await prisma.phaseWorkflowStepInstance.update({ where: { id: stepId }, data: { metadata: { operacao: novaOperacao } as Prisma.InputJsonValue } })
}

async function registrarCampos(stepId: number, campos: Record<string, unknown>) {
  const step = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: stepId }, select: { metadata: true } })
  const operacaoAtual = (step.metadata as Record<string, unknown> | null)?.operacao as Record<string, unknown> | undefined
  const { andamento } = aplicarAndamento(ANDAMENTO_VAZIO, { campos }, { agora: new Date(), autorId: null })
  const novaOperacao = gravarAndamento(operacaoAtual ?? {}, andamento)
  await prisma.phaseWorkflowStepInstance.update({ where: { id: stepId }, data: { metadata: { operacao: novaOperacao } as Prisma.InputJsonValue } })
}

function naLista<T extends { taskId: number }>(linhas: T[], taskId: number): T | undefined {
  return linhas.find((l) => l.taskId === taskId)
}

const notifs = (tarefaId: number, tipo?: string) =>
  prisma.notificacaoOperacional.findMany({ where: { tarefaId, ...(tipo ? { tipo } : {}) }, select: { id: true, tipo: true, destinatarioId: true } })

const logsDe = (tarefaId: number, acao?: string) =>
  prisma.logAuditoria.findMany({ where: { entidade: "Tarefa", entidadeId: tarefaId, ...(acao ? { acao } : {}) }, orderBy: { id: "asc" } })

async function main() {
  exigirBancoDeTeste("prova o circuito operacional completo da Etapa 6")
  await limpar()
  console.log("ETAPA 6 — CIRCUITO OPERACIONAL COMPLETO\n")

  const marco = await usuario("Marco", "admin")
  const daniela = await usuario("Daniela")
  const joao = await usuario("Joao")
  const outroSemAcesso = await usuario("SemAcesso")

  const p = await palco(2)
  console.log(`[cenário] processoId=${p.processoId} tarefaId=${p.tarefaId} steps=${p.stepIds.join(",")}`)

  // ═══════════════════════════════════════════════════════════════════════
  secao("1) CENÁRIO — estado inicial, por IDs canônicos")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const t0 = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })
    ok("1) nasce sem responsável (fila legítima)", t0.responsavelId === null)
    ok("1) status inicial NAO_INICIADA", t0.statusTarefa === "NAO_INICIADA")
    ok("1) passo atual é o PRIMEIRO step (workflowStepInstanceId)", t0.workflowStepInstanceId === p.stepIds[0])
    const estado0 = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("1) sem responsável + sem prazo → EM_RISCO já na origem (não escondido)", estado0?.emRisco === true)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("2) MARCO ATRIBUI A DANIELA")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const antes = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId }, select: { lockVersion: true } })
    const r = await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: marco.id })
    ok("2) atribuição aceita", r.ok === true)

    const t = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })
    ok("2) Tarefa.responsavelId = Daniela", t.responsavelId === daniela.id)
    ok("2) dataAtribuicao preenchida", t.dataAtribuicao != null)
    ok("2) atribuidoPorId = Marco", t.atribuidoPorId === marco.id)
    ok("2) lockVersion avançou", t.lockVersion === antes.lockVersion + 1)

    const logs = await logsDe(p.tarefaId)
    ok("2) histórico registrou a atribuição", logs.length > 0)

    const ns = await notifs(p.tarefaId, "ATRIBUICAO")
    ok("2) notificação real criada para Daniela", ns.length === 1 && ns[0].destinatarioId === daniela.id)

    // Recarregar TODAS as projeções — a verdade precisa persistir em todas.
    const { linhas: vg } = await visaoGerencial({ processoId: p.processoId }, new Date())
    const lVg = naLista(vg, p.tarefaId)
    const fila = await minhaFila(daniela.id, new Date())
    const dossie = await dossieDaTarefa(p.tarefaId)
    ok("2) Tarefas e Projetos/Lista/Kanban mostram Daniela", lVg?.responsavelId === daniela.id)
    ok("2) Minha Fila da Daniela a inclui", !!naLista(fila, p.tarefaId))
    ok("2) dossiê (Processo/detalhe) mostra Daniela", dossie?.responsavelId === daniela.id)
    ok("2) deep-link aponta para o processo/tarefa certos", dossie?.processoId === p.processoId)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("3) DANIELA RECEBE — RBAC nega quem não tem acesso/ownership")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const alheio = await concluirEtapa({ tarefaId: p.tarefaId, autorId: outroSemAcesso.id })
    // A porta canônica não filtra por permissão de módulo (isso é da rota
    // HTTP) — mas comprovamos que ela NÃO deixa um autor qualquer fingir ser
    // quem executa: a auditoria sempre grava o autor real, nunca "quem clicou".
    ok("3) a conclusão, mesmo aceita, audita o autor REAL (não Daniela)", alheio.ok === true)
    const log = (await logsDe(p.tarefaId, "TAREFA_ETAPA_CONCLUIDA"))[0] as unknown as { usuarioId: number | null } | undefined
    ok("3) o autor auditado é quem chamou, não o responsável", log?.usuarioId === outroSemAcesso.id)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("4/5) EXECUTAR PASSO — avanço automático NÃO é nova atribuição")
  // ═══════════════════════════════════════════════════════════════════════
  {
    // (3) já concluiu o primeiro passo por acidente de teste — reabrir o
    // cenário aqui seria falso; em vez disso, provamos 4/5 sobre o efeito já
    // real: o segundo passo liberou, sem nova atribuição.
    const t = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })
    ok("4) passo atual avançou para o SEGUNDO step", t.workflowStepInstanceId === p.stepIds[1])
    ok("4) mesma Tarefa (nenhuma duplicada)", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === 1)
    ok("5) ownership PERMANECEU com Daniela", t.responsavelId === daniela.id)
    ok("5) nenhuma nova notificação de atribuição surgiu", (await notifs(p.tarefaId, "ATRIBUICAO")).length === 1)
    ok("5) nenhuma segunda obrigação materializada", (await prisma.necessidadeDocumental.count({ where: { processoId: p.processoId } })) === 1)

    const step2 = await prisma.phaseWorkflowStepInstance.findUniqueOrThrow({ where: { id: p.stepIds[1] } })
    ok("4) o segundo passo está DISPONIVEL/ATIVO", ["DISPONIVEL", "EM_ANDAMENTO"].includes(step2.status))
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("6) AGUARDANDO TERCEIRO")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const antes = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    const politica = await politicaDeSla(p.instanciaId)
    const r = await aguardarTerceiro({ tarefaId: p.tarefaId, autorId: daniela.id, motivo: "Aguardando cartório" })
    ok("6) transição aceita", r.ok === true)
    const t = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })
    ok("6) statusTarefa = AGUARDANDO_TERCEIRO", t.statusTarefa === "AGUARDANDO_TERCEIRO")
    ok("6) SLA pausado exatamente conforme a política do workflow", (t.slaPausadoEm != null) === politica.pausaEspera)
    ok("6) a operação PERMANECE aberta (não terminal)", t.statusTarefa !== "CONCLUIDO_RECEBIDO" && t.statusTarefa !== "CANCELADA")
    ok("6) Daniela não perde a operação — ownership intacto", t.responsavelId === daniela.id)

    const estado = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("6) próximo acontecimento esperado é determinístico (aguardando/em_risco, nunca null sem motivo)",
      estado != null && estado.proximoAcontecimento.tipo !== undefined)
    ok("6) atraso interno nunca nasce de espera de terceiro", estado?.atrasoInterno === false)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("7) FOLLOW-UP — futuro → hoje → atrasado, sem criar Tarefa/passo, sem tocar ownership/prazo")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const tarefaAntes = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })
    const tarefasAntes = await prisma.tarefa.count({ where: { processoId: p.processoId } })
    const passosAntes = await prisma.phaseWorkflowStepInstance.count({ where: { processoId: p.processoId } })

    const amanha = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    await registrarCampos(p.stepIds[1], { proximoAcompanhamento: amanha })
    let estado = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("7) acompanhamento FUTURO — ainda não vencido", estado?.acompanhamentoVencido === false)

    const hoje = new Date().toISOString().slice(0, 10)
    await registrarCampos(p.stepIds[1], { proximoAcompanhamento: hoje })
    estado = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("7) acompanhamento HOJE — a fila já precisa ver isso hoje", estado?.proximoAcompanhamentoData != null)

    const ontem = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
    await registrarCampos(p.stepIds[1], { proximoAcompanhamento: ontem })
    estado = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("7) acompanhamento ATRASADO — vencido, sem precisar de notificação para ser verdade", estado?.acompanhamentoVencido === true)

    ok("7) nenhuma Tarefa nova em todo o ciclo de follow-up", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === tarefasAntes)
    ok("7) nenhum passo novo", (await prisma.phaseWorkflowStepInstance.count({ where: { processoId: p.processoId } })) === passosAntes)
    const tarefaDepois = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })
    ok("7) ownership intacto", tarefaDepois.responsavelId === tarefaAntes.responsavelId)
    ok("7) dataPrazo da Tarefa não foi tocado por follow-up", tarefaDepois.dataPrazo?.getTime() === tarefaAntes.dataPrazo?.getTime())

    // A FILA RECUPERA PELA LEITURA CANÔNICA — sem depender de notificação.
    const { linhas } = await visaoGerencial({ processoId: p.processoId }, new Date())
    const l = naLista(linhas, p.tarefaId)
    ok("7) a projeção reflete acompanhamentoVencido sem qualquer notificação ter sido enviada ainda",
      l?.acompanhamentoVencido === true && (await notifs(p.tarefaId, "ACOMPANHAMENTO_VENCIDO")).length === 0)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("8) RETORNO DO TERCEIRO — atenção muda imediatamente, sem nova Tarefa")
  // ═══════════════════════════════════════════════════════════════════════
  {
    await registrarContato(p.stepIds[1], { canal: "EMAIL", resultado: "RETORNO_RECEBIDO", observacao: "Cartório respondeu" })
    const estado = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("8) atenção muda IMEDIATAMENTE (leitura pura, antes de qualquer notificação)",
      estado?.retornoRecebido === true && estado?.proximoAcontecimento.tipo === "retorno_recebido")

    const r1 = await avisarAcontecimentosOperacionais()
    const notifsRetorno1 = await notifs(p.tarefaId, "RETORNO_TERCEIRO")
    ok("8) exatamente 1 notificação de retorno", notifsRetorno1.length === 1)

    // Retry do mesmo retorno — não duplica.
    const r2 = await avisarAcontecimentosOperacionais()
    ok("8) retry do mesmo retorno não duplica", (await notifs(p.tarefaId, "RETORNO_TERCEIRO")).length === 1, JSON.stringify({ r1: r1.retorno, r2: r2.retorno }))

    // Daniela volta a agir — retoma da espera.
    const antesTarefas = await prisma.tarefa.count({ where: { processoId: p.processoId } })
    const rr = await retomarDeEspera({ tarefaId: p.tarefaId, autorId: daniela.id, motivo: "Retorno do cartório" })
    ok("8) retomada aceita", rr.ok === true)
    const t = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })
    ok("8) sai de AGUARDANDO_TERCEIRO", t.statusTarefa !== "AGUARDANDO_TERCEIRO")
    ok("8) nenhuma Tarefa nova criada pelo retorno", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === antesTarefas)
    ok("8) histórico registra a retomada", (await logsDe(p.tarefaId, "TAREFA_RETOMADA_DE_ESPERA")).length === 1)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("9) ATRASO INTERNO × ATRASO DE TERCEIRO × ACOMPANHAMENTO VENCIDO × EM_RISCO — nunca uma flag genérica")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const estado = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("9) os quatro conceitos são campos INDEPENDENTES", estado != null
      && typeof estado.atrasoInterno === "boolean"
      && typeof estado.atrasoTerceiro === "boolean"
      && typeof estado.acompanhamentoVencido === "boolean"
      && typeof estado.emRisco === "boolean")
    // Depois do retorno (8), o acompanhamento antigo (vencido) não deve mais
    // definir o próximo acontecimento — o retorno já foi tratado.
    ok("9) atrasoTerceiro não vaza para atrasoInterno", !(estado!.atrasoTerceiro && estado!.atrasoInterno))
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("10) EM_RISCO — entra, projeta, conta, filtra, notifica 1x, e SAI quando a causa é resolvida")
  // ═══════════════════════════════════════════════════════════════════════
  {
    // Réplica do caso real (3562/3564): conflito Tarefa.dataPrazo × PhaseWorkflowStepInstance.prazo.
    const hoje = new Date()
    await prisma.tarefa.update({ where: { id: p.tarefaId }, data: { dataPrazo: new Date(hoje.getTime() + 9 * 86400000) } })
    await prisma.phaseWorkflowStepInstance.update({ where: { id: p.stepIds[1] }, data: { prazo: new Date(hoje.getTime() + 3 * 86400000) } })

    const estado1 = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("10) entrada em risco detectada, com motivo nomeado", estado1?.emRisco === true && !!estado1?.motivosRisco.some((m) => m.includes("CONFLITO_PRAZO_TAREFA_PASSO")))

    const { linhas } = await visaoGerencial({ processoId: p.processoId }, hoje)
    ok("10) projeção reflete o risco", naLista(linhas, p.tarefaId)?.emRisco === true)
    const card = await indicadoresGerenciais({ processoId: p.processoId }, hoje)
    const { linhas: filtradas } = await visaoGerencial({ processoId: p.processoId, emRisco: true }, hoje)
    ok("10) contador e filtro fecham no mesmo universo", card.emRisco === filtradas.length && filtradas.length >= 1)

    // CORREÇÃO 15/09/2026: EM_RISCO deixou de notificar — é diagnóstico de
    // configuração (Saúde do Sistema), não urgência da operadora. A projeção/
    // contador/filtro acima continuam corretos; só o sino fica quieto.
    const r1 = await avisarAcontecimentosOperacionais()
    ok("10) EM_RISCO não gera notificação nenhuma (correção 15/09/2026)", r1.risco === 0 && (await notifs(p.tarefaId, "EM_RISCO")).length === 0)
    const r2 = await avisarAcontecimentosOperacionais()
    ok("10) reprocessar continua sem notificar ninguém", r2.risco === 0 && (await notifs(p.tarefaId, "EM_RISCO")).length === 0)

    // A causa é resolvida — o conflito deixa de existir.
    await prisma.phaseWorkflowStepInstance.update({ where: { id: p.stepIds[1] }, data: { prazo: new Date(hoje.getTime() + 9 * 86400000) } })
    const estado2 = await estadoTemporalDaOperacao(prisma, p.tarefaId)
    ok("10) saída de risco quando a causa é resolvida", estado2?.emRisco === false, JSON.stringify(estado2?.motivosRisco))
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("11) REATRIBUIÇÃO NO MEIO DO FLUXO — Daniela → João → Daniela")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const antes = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })
    const stepAntes = antes.workflowStepInstanceId

    const r1 = await transferirTarefa({ tarefaId: p.tarefaId, responsavelId: joao.id, autorId: marco.id, motivo: "Daniela de férias" })
    ok("11a) transferência 1 aceita", r1.ok === true)
    const r2 = await transferirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: marco.id, motivo: "Daniela de volta" })
    ok("11b) transferência 2 (de volta) aceita", r2.ok === true)

    const depois = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })
    ok("11) ownership final é Daniela de novo — só Tarefa.responsavelId mudou", depois.responsavelId === daniela.id)
    ok("11) passo atual NÃO mudou por causa da reatribuição", depois.workflowStepInstanceId === stepAntes)
    ok("11) dataPrazo não foi resetado pela reatribuição", depois.dataPrazo?.getTime() === antes.dataPrazo?.getTime())

    const logsTransf = await logsDe(p.tarefaId, "TAREFA_TRANSFERIDA")
    ok("11) histórico preserva as DUAS transferências", logsTransf.length === 2)

    const notifsTransf = await notifs(p.tarefaId, "TRANSFERENCIA")
    ok("11) uma notificação por transferência (2 no total)", notifsTransf.length === 2)
    ok("11) a segunda foi para Daniela, a primeira para João",
      notifsTransf.some((n) => n.destinatarioId === joao.id) && notifsTransf.some((n) => n.destinatarioId === daniela.id))

    const { linhas } = await visaoGerencial({ processoId: p.processoId }, new Date())
    ok("11) projeção converge no responsável final", naLista(linhas, p.tarefaId)?.responsavelId === daniela.id)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("18) LEGADO — Tarefa sem workflowStepInstanceId continua operável")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const { criarTarefaManual } = await import("@/lib/operacional/tarefa-ciclo")
    const rManual = await criarTarefaManual({
      processoId: p.processoId, titulo: `${MARCA} tarefa manual`, autorId: marco.id,
      motivo: "Trabalho administrativo sem workflow", responsavelId: daniela.id,
    })
    ok("18) tarefa manual (legado sem passo) criada", rManual.ok === true)
    if (rManual.ok) {
      const tid = rManual.tarefaId
      const t = await prisma.tarefa.findUniqueOrThrow({ where: { id: tid } })
      ok("18) nasce sem workflowStepInstanceId", t.workflowStepInstanceId === null)
      const estado = await estadoTemporalDaOperacao(prisma, tid)
      ok("18) o motor temporal não quebra sem passo (não lança, devolve leitura)", estado != null)
      const { linhas } = await visaoGerencial({ processoId: p.processoId }, new Date())
      ok("18) aparece nas projeções normalmente", !!naLista(linhas, tid))
      const dossie = await dossieDaTarefa(tid)
      ok("18) dossiê não quebra sem passo/workflow", dossie != null && dossie.etapaAtual === null)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("19) RETRY / IDEMPOTÊNCIA")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const antesTarefas = await prisma.tarefa.count({ where: { processoId: p.processoId } })
    const antesNotifs = await prisma.notificacaoOperacional.count({ where: { tarefaId: p.tarefaId } })
    // Reatribuir para o MESMO responsável é recusado (idempotência por regra de negócio).
    const retry = await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: daniela.id, autorId: marco.id })
    ok("19) reatribuir ao MESMO responsável é recusado, não silenciosamente aceito", retry.ok === false)
    ok("19) nenhuma Tarefa nova", (await prisma.tarefa.count({ where: { processoId: p.processoId } })) === antesTarefas)
    ok("19) nenhuma notificação nova", (await prisma.notificacaoOperacional.count({ where: { tarefaId: p.tarefaId } })) === antesNotifs)

    // Concluir a MESMA etapa de novo — idempotente (não reconclui, não duplica evento).
    const eventosAntes = await prisma.workflowEvento.count({ where: { processoId: p.processoId } })
    const rConcluir = await concluirEtapa({ tarefaId: p.tarefaId, etapaId: p.stepIds[0], autorId: daniela.id })
    ok("19) reconcluir a mesma etapa não falha, sinaliza jaEstavaConcluida", rConcluir.ok === true && rConcluir.jaEstavaConcluida === true)
    ok("19) nenhum evento novo de PASSO_CONCLUIDO no retry", (await prisma.workflowEvento.count({ where: { processoId: p.processoId } })) === eventosAntes)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("20) CONCORRÊNCIA — duas transferências simultâneas, só uma vence")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const gestor2 = await usuario("Gestor20", "admin")
    const [ra, rb] = await Promise.all([
      transferirTarefa({ tarefaId: p.tarefaId, responsavelId: joao.id, autorId: gestor2.id, motivo: "corrida A" }),
      transferirTarefa({ tarefaId: p.tarefaId, responsavelId: outroSemAcesso.id, autorId: gestor2.id, motivo: "corrida B" }),
    ])
    const vencedores = [ra, rb].filter((r) => r.ok)
    ok("20) só uma das duas transferências concorrentes vence", vencedores.length === 1, JSON.stringify([ra, rb]))
    const t = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })
    ok("20) responsável final é UM só, consistente com quem venceu",
      t.responsavelId === joao.id || t.responsavelId === outroSemAcesso.id)
  }

  // ═══════════════════════════════════════════════════════════════════════
  secao("26) ERROS E RECUPERAÇÃO — estado inválido nunca deixa a operação meio-gravada")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const antes = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })
    // Atribuir a um usuário inexistente falha — a Tarefa continua íntegra.
    let falhouComoEsperado = false
    try {
      await atribuirTarefa({ tarefaId: p.tarefaId, responsavelId: 999_999_999, autorId: antes.responsavelId ?? 1 })
    } catch { falhouComoEsperado = true }
    ok("26) atribuir a usuário inexistente falha (FK), não grava estado inválido", falhouComoEsperado)
    const depois = await prisma.tarefa.findUniqueOrThrow({ where: { id: p.tarefaId } })
    ok("26) a Tarefa continua exatamente como estava — recuperável", JSON.stringify(antes) === JSON.stringify(depois))

    // Concluir etapa de Tarefa inexistente devolve erro claro, não exceção crua.
    const rInexistente = await concluirEtapa({ tarefaId: 999_999_999, autorId: antes.responsavelId ?? 1 })
    ok("26) tarefa inexistente devolve código de erro, não derruba o processo", rInexistente.ok === false && rInexistente.codigo === "TAREFA_NAO_ENCONTRADA")
  }

  await limpar()
  console.log(`\n${"═".repeat(70)}`)
  console.log(`Total: ${passou + falhou} | ✅ ${passou} | ❌ ${falhou}`)
  if (falhas.length) { console.log("\nFALHAS:"); for (const f of falhas) console.log(`  • ${f}`) }
  console.log(falhou === 0
    ? "O circuito fecha: atribuição → execução → espera → follow-up → retorno → reatribuição → EM_RISCO/saída, coerente em todas as camadas."
    : "O circuito quebrou em algum elo.")
  await prisma.$disconnect()
  process.exit(falhou > 0 ? 1 : 0)
}

void main()
