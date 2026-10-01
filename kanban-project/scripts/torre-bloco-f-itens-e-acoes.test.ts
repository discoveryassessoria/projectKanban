// scripts/torre-bloco-f-itens-e-acoes.test.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO F (29/09/2026) — os 7 tipos de "Precisa de você" e
// as ações reais e auditadas sobre eles, mais o Desfazer.
//
//   npx tsx scripts/torre-bloco-f-itens-e-acoes.test.ts
//
// FASE DEIXADA usa fases REAIS do catálogo congelado (`fasesAnterioresA` só
// aceita phaseKey do catálogo — nunca uma chave sintética de teste).
// DIVERGÊNCIA usa uma PhaseWorkflowStepInstance mínima (sem publicar
// workflow: `conferirCoerenciaPassoTarefa` só lê status, não valida cadastro).
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bloco-f-itens-e-acoes.test.ts")

import { prisma } from "../lib/prisma"
import { itensPrecisaDeVoce } from "../lib/operacional/precisa-de-voce"
import * as acoes from "../src/services/precisa-de-voce-acoes"
import { garantirOferta } from "./_fixture-oferta"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "TORRE_F_ITENS_"

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const procIds = procs.map((p) => p.id)
  await prisma.mensagem.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.tarefa.deleteMany({ where: { OR: [{ titulo: { startsWith: MARCA } }, { processoId: { in: procIds } }] } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  await prisma.saudeAchado.deleteMany({ where: { chave: { startsWith: MARCA } } })
  await prisma.logAuditoria.deleteMany({ where: { descricao: { contains: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } })
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  await prisma.tipoProcessoModalidadeHabilitada.deleteMany({ where: { tipoProcessoId: { in: tipos.map((t) => t.id) } } })
  await prisma.faseMacro.deleteMany({ where: { macroWorkflow: { tipoProcessoId: { in: tipos.map((t) => t.id) } } } })
  await prisma.macroWorkflow.deleteMany({ where: { tipoProcessoId: { in: tipos.map((t) => t.id) } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipos.map((t) => t.id) } } })
}

async function main() {
  await limpar()

  const agora = new Date("2026-09-30T12:00:00.000Z")

  const admin = await prisma.usuario.create({ data: { nome: `${MARCA}Admin`, email: `${MARCA}admin@teste.com`, senha: "x", tipo: "admin" } })
  const alguem = await prisma.usuario.create({ data: { nome: `${MARCA}Alguem`, email: `${MARCA}alguem@teste.com`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.iniciar_concluir": true } } })

  secao("FASE DEIXADA — catálogo congelado: genealogia é anterior a emissao_documental")
  const procFase = await prisma.processo.create({ data: { nome: `${MARCA}proc-fase-deixada`, faseAtualKey: "emissao_documental" } })
  const tarefaFaseDeixada = await prisma.tarefa.create({
    data: { titulo: `${MARCA}fase-deixada`, processoId: procFase.id, faseMacroKey: "genealogia", statusTarefa: "EM_ANDAMENTO", dataPrazo: new Date(agora.getTime() + 10 * 86_400_000) },
  })

  secao("SEM DONO + BLOQUEADA")
  const procOutros = await prisma.processo.create({ data: { nome: `${MARCA}proc-outros`, faseAtualKey: "emissao_documental" } })
  const tarefaSemDono = await prisma.tarefa.create({
    data: { titulo: `${MARCA}sem-dono`, processoId: procOutros.id, faseMacroKey: "emissao_documental", statusTarefa: "NAO_INICIADA" },
  })
  const tarefaBloqueada = await prisma.tarefa.create({
    data: { titulo: `${MARCA}bloqueada`, processoId: procOutros.id, faseMacroKey: "emissao_documental", statusTarefa: "BLOQUEADA", responsavelId: alguem.id, justificativa: `${MARCA}motivo do bloqueio` },
  })

  secao("SÓ TAREFA ABERTA — achado real 30/09: CONCLUIDO_RECEBIDO não é 'aberta'")
  // Mesma forma de fase-deixada e sem-dono, mas CONCLUIDA — não pode aparecer
  // em NENHUM dos 7 tipos (a tarefa foi entregue; "continua aberta" seria falso).
  const tarefaConcluidaFaseAnterior = await prisma.tarefa.create({
    data: { titulo: `${MARCA}concluida-fase-anterior`, processoId: procFase.id, faseMacroKey: "genealogia", statusTarefa: "CONCLUIDO_RECEBIDO", dataConclusao: agora },
  })
  const tarefaConcluidaSemDono = await prisma.tarefa.create({
    data: { titulo: `${MARCA}concluida-sem-dono`, processoId: procOutros.id, faseMacroKey: "emissao_documental", statusTarefa: "CONCLUIDO_RECEBIDO", dataConclusao: agora },
  })

  secao("NUNCA FASE FUTURA — a fase da tarefa ainda não chegou, pela ordem do cadastro")
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}pais`, modalityKey: "administrativa" })
  const tipoFuturo = await prisma.tipoProcessoNacionalidade.create({
    data: { code: `${MARCA}tipo`, name: `${MARCA}tipo`, paisId: oferta.paisId, processFamily: "cidadania", serviceNature: "main_process" },
  })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipoFuturo.id, modalidadeId: oferta.modalidadeId } })
  const macroFuturo = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipoFuturo.id, modalidadeId: oferta.modalidadeId, name: `${MARCA}macro`, versao: 1 } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macroFuturo.id, phaseKey: `${MARCA}fase_atual`, label: "atual", ordem: 0, versao: 1, required: true, conditional: false } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macroFuturo.id, phaseKey: `${MARCA}fase_futura`, label: "futura", ordem: 1, versao: 1, required: true, conditional: false } })
  const procComFuturo = await prisma.processo.create({ data: { nome: `${MARCA}proc-com-futuro`, tipoProcessoMotorId: tipoFuturo.id, faseAtualKey: `${MARCA}fase_atual` } })
  const tarefaFaseFutura = await prisma.tarefa.create({
    data: { titulo: `${MARCA}fase-futura`, processoId: procComFuturo.id, faseMacroKey: `${MARCA}fase_futura`, statusTarefa: "NAO_INICIADA" },
  })
  const tarefaFaseAtualMesmoProc = await prisma.tarefa.create({
    data: { titulo: `${MARCA}fase-atual-mesmo-proc`, processoId: procComFuturo.id, faseMacroKey: `${MARCA}fase_atual`, statusTarefa: "NAO_INICIADA" },
  })

  secao("DIVERGÊNCIA — passo CONCLUIDO, tarefa NAO_INICIADA (contradição real)")
  const wfInst = await prisma.phaseWorkflowInstance.create({
    data: { processoId: procOutros.id, faseMacroKey: "emissao_documental", chaveIdempotencia: `${MARCA}wf-inst` },
  })
  const stepInst = await prisma.phaseWorkflowStepInstance.create({
    data: { workflowInstanceId: wfInst.id, processoId: procOutros.id, faseMacroKey: "emissao_documental", stepKey: `${MARCA}passo`, status: "CONCLUIDO", chaveIdempotencia: `${MARCA}step-inst` },
  })
  const tarefaDivergente = await prisma.tarefa.create({
    data: { titulo: `${MARCA}divergente`, processoId: procOutros.id, faseMacroKey: "emissao_documental", statusTarefa: "NAO_INICIADA", workflowStepInstanceId: stepInst.id },
  })

  secao("CARGA — pessoa no limite do cadastro")
  const noLimite = await prisma.usuario.create({ data: { nome: `${MARCA}NoLimite`, email: `${MARCA}nolimite@teste.com`, senha: "x", tipo: "assistente" } })
  await prisma.capacidadeOperacional.create({ data: { usuarioId: noLimite.id, limiteExecutaveis: 2 } })
  await prisma.tarefa.create({ data: { titulo: `${MARCA}carga-1`, responsavelId: noLimite.id, statusTarefa: "NAO_INICIADA" } })
  await prisma.tarefa.create({ data: { titulo: `${MARCA}carga-2`, responsavelId: noLimite.id, statusTarefa: "EM_ANDAMENTO" } })

  secao("PAREDE À FRENTE — achado CAD-012 aberto")
  const achado = await prisma.saudeAchado.create({
    data: {
      chave: `${MARCA}CAD-012::teste`, codigo: "CAD-012", dominio: "WORKFLOW", modulo: "Cadastro do passo", severidade: "ERRO",
      titulo: `${MARCA}Fase entra sem passo executável`, descricao: "Cadastro sem resultado nem executor.", status: "ABERTO",
      link: "/administrator?screen=syshealth", versaoCatalogo: "teste",
    },
  })

  const itens = await itensPrecisaDeVoce({ agora })

  const porTipo = (t: string) => itens.filter((i) => i.tipo === t)
  ok("FASE_DEIXADA detectada (genealogia < emissao_documental)", porTipo("FASE_DEIXADA").some((i) => i.tarefaId === tarefaFaseDeixada.id))
  ok("FASE_DEIXADA tem score 3 (baseline) + o que mais se aplicar", porTipo("FASE_DEIXADA").find((i) => i.tarefaId === tarefaFaseDeixada.id)!.score >= 3)
  ok("SEM_DONO detectada", porTipo("SEM_DONO").some((i) => i.tarefaId === tarefaSemDono.id))
  ok("uma tarefa SEM_DONO nunca aparece também como FASE_DEIXADA/DIVERGÊNCIA (mutuamente exclusivo)",
    !porTipo("FASE_DEIXADA").some((i) => i.tarefaId === tarefaSemDono.id) && !porTipo("DIVERGENCIA").some((i) => i.tarefaId === tarefaSemDono.id))
  ok("BLOQUEADA detectada, com o motivo no detalhe", porTipo("BLOQUEADA").some((i) => i.tarefaId === tarefaBloqueada.id && i.detalhe.includes(`${MARCA}motivo`)))
  ok("DIVERGENCIA detectada (passo CONCLUIDO × tarefa NAO_INICIADA)", porTipo("DIVERGENCIA").some((i) => i.tarefaId === tarefaDivergente.id))
  ok("CARGA detectada para quem está no limite", porTipo("CARGA").some((i) => i.familiaNome === noLimite.nome))
  ok("achado de CADASTRO (CAD-012 aberto) NÃO entra no 'Precisa de você' (a Torre é só gestão de processo)", porTipo("PAREDE_A_FRENTE").length === 0 && !itens.some((i) => (i.contexto as { achadoId?: number }).achadoId === achado.id))
  ok("lista ordenada por score, maior primeiro", itens.every((it, i) => i === 0 || itens[i - 1].score >= it.score))

  ok("tarefa CONCLUIDA nunca aparece (nem como fase deixada)", !itens.some((i) => i.tarefaId === tarefaConcluidaFaseAnterior.id))
  ok("tarefa CONCLUIDA nunca aparece (nem como sem dono)", !itens.some((i) => i.tarefaId === tarefaConcluidaSemDono.id))
  ok("tarefa de fase FUTURA nunca aparece (a fase ainda não chegou, pela ordem do cadastro)", !itens.some((i) => i.tarefaId === tarefaFaseFutura.id))
  ok("...mas a tarefa da fase ATUAL do mesmo processo aparece normalmente", itens.some((i) => i.tarefaId === tarefaFaseAtualMesmoProc.id))

  secao("AÇÕES — Fase deixada / Sem dono")
  const rAtribui = await acoes.atribuirSugerido(tarefaSemDono.id, admin.id)
  ok("atribuir sugerido: real (grava responsavelId)", rAtribui.ok === true)
  const depoisAtribuir = await prisma.tarefa.findUnique({ where: { id: tarefaSemDono.id }, select: { responsavelId: true } })
  ok("...e persiste", depoisAtribuir?.responsavelId != null)

  const rEncerra = await acoes.encerrarNaoDevida(tarefaFaseDeixada.id, `${MARCA}não é mais devida`, admin.id)
  ok("encerrar não devida: cancela com justificativa", rEncerra.ok === true)
  const depoisEncerra = await prisma.tarefa.findUnique({ where: { id: tarefaFaseDeixada.id }, select: { statusTarefa: true, justificativa: true } })
  ok("...CANCELADA, nunca CONCLUIDA (regra permanente)", depoisEncerra?.statusTarefa === "CANCELADA")

  secao("AÇÕES — Divergência")
  const rReconcilia = await acoes.reconciliar(tarefaDivergente.id, admin.id)
  ok("reconciliar: real (projeta o passo na tarefa)", rReconcilia.ok === true, JSON.stringify(rReconcilia))
  const depoisReconcilia = await prisma.tarefa.findUnique({ where: { id: tarefaDivergente.id }, select: { statusTarefa: true } })
  ok("...tarefa passa a espelhar o passo (CONCLUIDO → CONCLUIDO_RECEBIDO)", depoisReconcilia?.statusTarefa === "CONCLUIDO_RECEBIDO")
  const rReconciliaDeNovo = await acoes.reconciliar(tarefaDivergente.id, admin.id)
  ok("reconciliar de novo: já coerente, recusa (idempotência honesta)", rReconciliaDeNovo.ok === false)

  const rVer3 = await acoes.ver3Fontes(tarefaSemDono.id)
  ok("ver 3 fontes: devolve tarefa/passo/central", rVer3.ok === true && "fontes" in rVer3)

  secao("AÇÕES — Escalada (caminho de erro sem subtarefa vigente)")
  const rLigacao = await acoes.registrarLigacao(tarefaBloqueada.id, admin.id)
  ok("registrar ligação sem passo vinculado: recusa com erro claro, nunca finge sucesso", rLigacao.ok === false)
  const rCanal = await acoes.trocarCanal(tarefaBloqueada.id, "EMAIL", admin.id)
  ok("trocar canal sem solicitação vinculada: recusa", rCanal.ok === false)
  ok("trocar canal com canal inválido: recusa", (await acoes.trocarCanal(tarefaBloqueada.id, "POMBO_CORREIO", admin.id)).ok === false)

  secao("AÇÕES — Bloqueada")
  const rCobrar = await acoes.cobrarCliente(tarefaBloqueada.id, admin.id, `${MARCA}mensagem de cobrança`)
  ok("cobrar cliente: cria mensagem real no chat do processo", rCobrar.ok === true)
  if (rCobrar.ok) {
    const msg = await prisma.mensagem.findUnique({ where: { id: rCobrar.mensagemId as number } })
    ok("...com o conteúdo certo", msg?.conteudo === `${MARCA}mensagem de cobrança`)
  }
  const rDesbloqueia = await acoes.desbloquear(tarefaBloqueada.id, admin.id, `${MARCA}liberado`)
  ok("desbloquear: real (reusa a porta existente, já auditada por ela)", rDesbloqueia.ok === true)
  const depoisDesbloqueio = await prisma.tarefa.findUnique({ where: { id: tarefaBloqueada.id }, select: { statusTarefa: true } })
  ok("...sai de BLOQUEADA", depoisDesbloqueio?.statusTarefa !== "BLOQUEADA")

  secao("AÇÕES — Carga")
  // Torre nova (01/10/2026): só se move para quem tem APTIDÃO comprovada — sem aptidão cadastrada nada é movido por chute.
  // (O caminho feliz, com apto de fila livre, está em torre-nova-precisa-decisoes.test.ts.)
  const rRedistribui = await acoes.redistribuirPorCarga(noLimite.id, admin.id)
  ok("redistribuir por carga SEM nenhum apto cadastrado: recusa com motivo e não move nada", rRedistribui.ok === false && (await prisma.tarefa.count({ where: { titulo: { startsWith: `${MARCA}carga-` }, responsavelId: noLimite.id } })) === 2, JSON.stringify(rRedistribui))
  const rVerEquipe = await acoes.verEquipe(noLimite.id)
  ok("ver equipe: leitura, nunca escreve", rVerEquipe.ok === true)

  secao("AÇÕES — Parede à frente")
  const rAbrir = await acoes.abrirGerenciamento(achado.id)
  ok("abrir Gerenciamento: devolve o link do achado", rAbrir.ok === true && (rAbrir as { link?: string }).link === "/administrator?screen=syshealth")
  const rIgnora = await acoes.ignorar7Dias(achado.id, `${MARCA}vamos resolver na sprint`, admin.id)
  ok("ignorar 7 dias: exige justificativa e audita", rIgnora.ok === true)
  const achadoDepois = await prisma.saudeAchado.findUnique({ where: { id: achado.id } })
  ok("...status IGNORADO, mas segue existindo (nunca some do painel de Saúde)", achadoDepois?.status === "IGNORADO")
  const itensDepoisDeIgnorar = await itensPrecisaDeVoce({ agora })
  ok("...e some da lista do Precisa de você enquanto ignorado", !itensDepoisDeIgnorar.some((i) => (i.contexto as { achadoId?: number }).achadoId === achado.id))
  ok("ignorar sem justificativa: recusa", (await acoes.ignorar7Dias(achado.id, "", admin.id)).ok === false)

  secao("DESFAZER — individual, lote e recusa se mudou desde então")
  const tarefaParaDesfazer = await prisma.tarefa.create({ data: { titulo: `${MARCA}desfazer-1`, statusTarefa: "NAO_INICIADA" } })
  await acoes.atribuirEscolhido(tarefaParaDesfazer.id, alguem.id, admin.id)
  const antesDesfazer = await prisma.tarefa.findUnique({ where: { id: tarefaParaDesfazer.id }, select: { responsavelId: true } })
  ok("atribuiu de fato antes de testar o desfazer", antesDesfazer?.responsavelId === alguem.id)

  const rDesfaz = await acoes.desfazerAtribuicao([tarefaParaDesfazer.id], admin.id)
  ok("desfazer individual: 1 de 1", rDesfaz.desfeitas === 1 && rDesfaz.total === 1)
  const depoisDesfazer = await prisma.tarefa.findUnique({ where: { id: tarefaParaDesfazer.id }, select: { responsavelId: true } })
  ok("...volta para a fila (era null antes da atribuição)", depoisDesfazer?.responsavelId == null)

  const logDesfazer = await prisma.logAuditoria.findFirst({ where: { acao: "TAREFA_ATRIBUICAO_DESFEITA", entidadeId: tarefaParaDesfazer.id } })
  ok("desfazer é auditado", logDesfazer != null)

  // LOTE
  const loteA = await prisma.tarefa.create({ data: { titulo: `${MARCA}lote-a`, statusTarefa: "NAO_INICIADA" } })
  const loteB = await prisma.tarefa.create({ data: { titulo: `${MARCA}lote-b`, statusTarefa: "NAO_INICIADA" } })
  await acoes.atribuirEscolhido(loteA.id, alguem.id, admin.id)
  await acoes.atribuirEscolhido(loteB.id, alguem.id, admin.id)
  const rDesfazLote = await acoes.desfazerAtribuicao([loteA.id, loteB.id], admin.id)
  ok("desfazer em lote: 2 de 2", rDesfazLote.desfeitas === 2 && rDesfazLote.total === 2)

  // RECUSA — o registro de auditoria da atribuição já não bate com o estado
  // real da tarefa (simulado aqui como uma escrita fora da porta auditada —
  // o cenário real é uma corrida entre dois desfazeres/atribuições; a trava é
  // a mesma: só desfaz quem ainda está exatamente como o log deixou).
  const mudouDepois = await prisma.tarefa.create({ data: { titulo: `${MARCA}mudou-depois`, statusTarefa: "NAO_INICIADA" } })
  await acoes.atribuirEscolhido(mudouDepois.id, alguem.id, admin.id)
  await prisma.tarefa.update({ where: { id: mudouDepois.id }, data: { responsavelId: noLimite.id } })
  const rDesfazAntiga = await acoes.desfazerAtribuicao([mudouDepois.id], admin.id)
  ok("desfazer recusa quando o estado real já não bate com o log da atribuição", rDesfazAntiga.desfeitas === 0)

  await limpar()

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
