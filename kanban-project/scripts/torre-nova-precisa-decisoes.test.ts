// scripts/torre-nova-precisa-decisoes.test.ts
// ============================================================================
// TORRE NOVA, FRENTE B2 (01/10/2026) — "PRECISA DE VOCÊ": AS DECISÕES DO DIA (banco de teste).
//
//   npx tsx scripts/torre-nova-precisa-decisoes.test.ts   (banco de teste)
//
// Prova, com dados reais do banco efêmero: "Sem responsável" agrega por PROCESSO e só sugere quem tem APTIDÃO comprovada; "Fase deixada" é
// a fase sem próxima ação e "Avançar fase" passa pela PORTA CANÔNICA (gate) — sem gate aberto pede justificativa e fica como avanço
// FORÇADO no PhaseAdvanceLog; "Escalada" respeita o limite do cadastro; "Bloqueada" só com 10+ dias; "Carga" só move para apto de fila livre;
// o Desfazer lê o próprio log e recusa o que mudou; o processo pausado some; a Visão geral e a aba leem a MESMA resposta.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-nova-precisa-decisoes.test.ts")

import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { definirAptidoes, definirCapacidade } from "../lib/operacional/organizacao"
import { montarPrecisaDeVoce, itensPrecisaDeVoce, semDonoDoProcesso, type ItemPrecisaDeVoceTorre } from "../lib/operacional/precisa-de-voce"
import { briefingDoDia } from "../lib/operacional/precisa-de-voce-decisoes"
import { registrarCobranca } from "../src/services/subtarefas-da-etapa"
import { pausarProcesso } from "../src/services/processo-pausa"
import { publicarWorkflow } from "../src/services/publicacao-de-workflow"
import * as acoes from "../src/services/precisa-de-voce-acoes"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORRE_NPDV"
const DIA = 86_400_000
const EXEC = { "tarefas.iniciar_concluir": true, "tarefas.ver": true }

async function main() {
  const c = await montarCenario(MARCA, { escalarApos: 2 })
  const emailDe = (n: string) => `${MARCA.toLowerCase()}-${n.toLowerCase()}@t.com`
  const mk = (nome: string, perms: Record<string, boolean>) =>
    prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: emailDe(nome), senha: "x", tipo: "assistente", permissoesCustom: perms } })
  try {
    const admin = await prisma.usuario.create({ data: { nome: `${MARCA} Admin`, email: emailDe("admin"), senha: "x", tipo: "admin" } })
    const apto = await mk("Apto", EXEC)
    const outro = await mk("Outro", EXEC)
    const perfil = await prisma.perfilOperacionalDocumento.create({ data: { code: `${MARCA}_PERF`, name: `${MARCA} Itália` } })
    const tipoDoc = await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}_TIPO`, name: `${MARCA} Cert`, perfilOperacionalId: perfil.id } })
    await definirAptidoes(apto.id, [perfil.id])

    /** Uma certidão de uma pessoa NO MESMO processo (documento tipado → unidade de trabalho → aptidão). */
    const certidaoNoProcesso = async (processoId: number, titulo: string, o: { tipada: boolean; responsavelId?: number | null; status?: "NAO_INICIADA" | "EM_ANDAMENTO" | "BLOQUEADA"; fase?: string }) => {
      const proc = await prisma.processo.findUniqueOrThrow({ where: { id: processoId }, select: { arvoreId: true } })
      let documentoId: number | null = null
      if (o.tipada) {
        const pessoa = await prisma.pessoa.create({ data: { arvoreId: proc.arvoreId!, nome: `${MARCA} ${titulo}`, sobrenome: "Teste", linhaReta: true, requerente: "nao" }, select: { id: true } })
        const doc = await prisma.documento.create({ data: { pessoaId: pessoa.id, descricao: `${MARCA} doc ${titulo}`, documentTypeId: tipoDoc.id }, select: { id: true } })
        documentoId = doc.id
      }
      return prisma.tarefa.create({
        data: {
          titulo: `${MARCA} ${titulo}`, processoId, faseMacroKey: o.fase ?? c.PHASE_KEY, statusTarefa: o.status ?? "NAO_INICIADA",
          responsavelId: o.responsavelId ?? null, ...(documentoId ? { documentoId } : {}),
          ...(o.status === "BLOQUEADA" ? { justificativa: `${MARCA} motivo do bloqueio`, motivoCodigo: "BLOQUEIO", blockedPreviousStatus: "NAO_INICIADA" } : {}),
        },
        select: { id: true },
      })
    }
    const decisoes = async (): Promise<ItemPrecisaDeVoceTorre[]> => (await montarPrecisaDeVoce(new Date(), undefined, { nomeDoUsuario: "Marco Rovatti" })).itens
    const doProc = (itens: ItemPrecisaDeVoceTorre[], processoId: number, tipo: string) => itens.filter((i) => i.processoId === processoId && i.tipo === tipo)

    // ─── SEM RESPONSÁVEL: um item por PROCESSO ────────────────────────────────────────────────
    secao("SEM RESPONSÁVEL — um item por PROCESSO (não por tarefa), com a aptidão comprovada")
    const p1 = await c.novaObrigacao({ responsavelId: null })
    const t1a = await certidaoNoProcesso(p1.processoId, "p1-apta-a", { tipada: true })
    const t1b = await certidaoNoProcesso(p1.processoId, "p1-apta-b", { tipada: true })
    const t1c = await certidaoNoProcesso(p1.processoId, "p1-sem-unidade", { tipada: false })
    const p2 = await c.novaObrigacao({ responsavelId: null })   // a tarefa do fixture é sem dono e sem unidade
    let itens = await decisoes()
    const sd1 = doProc(itens, p1.processoId, "SEM_DONO")
    ok("o processo 1 aparece UMA vez em Sem responsável (4 certidões: a do fixture + 3)", sd1.length === 1, `${sd1.length} item(ns)`)
    const i1 = sd1[0]
    ok("título: '<família> · 4 certidões sem responsável'; item de PROCESSO (sem tarefaId)", /· 4 certidões sem responsável$/.test(i1?.titulo ?? "") && i1?.tarefaId == null)
    ok("o link do título é o Detalhe do Processo", i1?.link === `/torre/processo/${p1.processoId}`)
    ok("as 4 certidões estão no contexto", Array.isArray(i1?.contexto.tarefaIds) && (i1.contexto.tarefaIds as number[]).length === 4)
    ok("sugestão: Atribuir ao APTO (só ele tem aptidão à unidade) — e diz que as sem aptidão ficam para a decisão humana",
      new RegExp(`^Atribuir a ${MARCA} Apto`).test(i1?.sugestao ?? "") && /sem aptidão cadastrada ficam para você/.test(i1?.sugestao ?? ""), i1?.sugestao ?? "")
    ok("ações: 'Atribuir a <apto>' e 'Escolher outro'", i1?.acao1.rotulo === `Atribuir a ${MARCA} Apto` && i1.acao1.acao === "ATRIBUIR_SUGERIDO" && i1.acao2.rotulo === "Escolher outro" && i1.acao2.acao === "ATRIBUIR_ESCOLHIDO")
    const sd2 = doProc(itens, p2.processoId, "SEM_DONO")[0]
    ok("processo SEM nenhuma aptidão cadastrada: NINGUÉM é sugerido ('Sem aptidão cadastrada…') e o botão é 'Escolher responsável'",
      /^Sem aptidão cadastrada/.test(sd2?.sugestao ?? "") && sd2.acao1.rotulo === "Escolher responsável" && !/Atribuir a/.test(sd2.sugestao ?? ""), sd2?.sugestao ?? "")
    ok("o administrador nunca é sugerido", !itens.some((i) => /Admin/.test(i.sugestao ?? "") || /Admin/.test(i.acao1.rotulo)))
    ok("a ação age exatamente no conjunto que a lista mostra (semDonoDoProcesso == contexto.tarefaIds)",
      JSON.stringify((await semDonoDoProcesso(p1.processoId, new Date())).sort()) === JSON.stringify([...(i1.contexto.tarefaIds as number[])].sort()))
    ok("o limite de cobranças que escala vai no contexto de cada decisão (regra do cartão Escalada)", itens.every((i) => i.contexto.escaladaApos === 2))

    secao("SEM RESPONSÁVEL — ações por processo (porta de atribuição, auditada) e Desfazer")
    const rRecusa = await acoes.atribuirSugeridoDoProcesso(p2.processoId, admin.id)
    ok("sem aptidão cadastrada: 'Atribuir' RECUSA (decisão humana) e nada é atribuído", rRecusa.ok === false && (await prisma.tarefa.findUnique({ where: { id: p2.tarefaId }, select: { responsavelId: true } }))?.responsavelId == null, JSON.stringify(rRecusa))
    const rSug = await acoes.atribuirSugeridoDoProcesso(p1.processoId, admin.id)
    ok("atribuir sugerido: só as certidões do APTO (2 de 4) são atribuídas ao apto", rSug.ok === true && (await prisma.tarefa.count({ where: { id: { in: [t1a.id, t1b.id] }, responsavelId: apto.id } })) === 2, JSON.stringify(rSug))
    ok("...as sem aptidão continuam sem responsável (nada por chute)", (await prisma.tarefa.count({ where: { id: { in: [t1c.id, p1.tarefaId] }, responsavelId: null } })) === 2)
    const feitas = ((rSug as { itens?: Array<{ tarefaId: number; ok: boolean }> }).itens ?? []).filter((i) => i.ok).map((i) => i.tarefaId)
    const rDesf = await acoes.desfazerAtribuicao(feitas, admin.id)
    ok("Desfazer devolve as 2 certidões à fila (lê o próprio log da atribuição)", rDesf.desfeitas === 2 && (await prisma.tarefa.count({ where: { id: { in: [t1a.id, t1b.id] }, responsavelId: null } })) === 2, JSON.stringify(rDesf))
    const rEsc = await acoes.atribuirEscolhidoDoProcesso(p1.processoId, outro.id, admin.id)
    ok("escolher outro: as 4 certidões do processo vão para a pessoa escolhida", rEsc.ok === true && (await prisma.tarefa.count({ where: { processoId: p1.processoId, responsavelId: outro.id } })) === 4, JSON.stringify(rEsc))
    itens = await decisoes()
    ok("resolvido, o processo sai de Sem responsável (a contagem é a real, não a do protótipo)", doProc(itens, p1.processoId, "SEM_DONO").length === 0)

    // ─── ESCALADA ─────────────────────────────────────────────────────────────────────────────
    secao("ESCALADA — cobrança sem resposta ≥ o limite do cadastro (escalarApos)")
    const orgao = await c.novoOrgao("Cartório Escalado")
    const esc = await c.novaObrigacao({ aguardando: true, orgaoId: orgao.id, responsavelId: apto.id, comSolicitacao: { canal: "EMAIL" } })
    await prisma.documento.update({ where: { id: esc.documentoId! }, data: { orgaoId: orgao.id } })
    const umaCobranca = await c.novaObrigacao({ aguardando: true, orgaoId: orgao.id, responsavelId: apto.id })
    await registrarCobranca({ stepInstanceId: umaCobranca.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA" })
    await registrarCobranca({ stepInstanceId: esc.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA" })
    await registrarCobranca({ stepInstanceId: esc.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "TELEFONE", resultado: "SEM_RESPOSTA" })
    itens = await decisoes()
    const eItem = itens.find((i) => i.tipo === "ESCALADA" && i.tarefaId === esc.tarefaId)
    ok("2 cobranças sem resposta (limite do cadastro = 2) → Escalada", !!eItem)
    ok("1 cobrança sem resposta NÃO escala", !itens.some((i) => i.tipo === "ESCALADA" && i.tarefaId === umaCobranca.tarefaId))
    ok("título: '<órgão> · <certidão>'", (eItem?.titulo ?? "").startsWith(`${orgao.name} · `), eItem?.titulo ?? "")
    ok("detalhe: '… · pedido há 0 d · 2 cobranças por e-mail e telefone sem resposta'", /pedido há menos de 1 dia · 2 cobranças por e-mail e telefone sem resposta$/.test(eItem?.detalhe ?? ""), eItem?.detalhe ?? "")
    ok("ações: 'Registrar ligação' e 'Trocar canal'", eItem?.acao1.rotulo === "Registrar ligação" && eItem.acao2.rotulo === "Trocar canal")

    secao("ESCALADA — Trocar canal e Desfazer (devolve o canal anterior; recusa se mudou depois)")
    const rCanal = await acoes.trocarCanal(esc.tarefaId, "WHATSAPP", admin.id)
    ok("trocar canal: EMAIL → WHATSAPP", rCanal.ok === true && (await prisma.solicitacaoDocumento.findFirst({ where: { tarefaId: esc.tarefaId } }))?.canal === "WHATSAPP")
    const rDesCanal = await acoes.desfazerTrocaDeCanal(esc.tarefaId, admin.id)
    ok("Desfazer: o canal volta para EMAIL", rDesCanal.ok === true && (await prisma.solicitacaoDocumento.findFirst({ where: { tarefaId: esc.tarefaId } }))?.canal === "EMAIL", JSON.stringify(rDesCanal))
    await acoes.trocarCanal(esc.tarefaId, "BALCAO", admin.id)
    await prisma.solicitacaoDocumento.updateMany({ where: { tarefaId: esc.tarefaId }, data: { canal: "CORREIOS" } })
    ok("Desfazer RECUSA quando o canal mudou depois da troca", (await acoes.desfazerTrocaDeCanal(esc.tarefaId, admin.id)).ok === false)

    // ─── BLOQUEADA ────────────────────────────────────────────────────────────────────────────
    secao("BLOQUEADA — esperando o cliente há 10+ dias (ou sem data registrada)")
    const pb = await c.novaObrigacao({ responsavelId: apto.id })
    const antiga = await certidaoNoProcesso(pb.processoId, "bloq-antiga", { tipada: false, responsavelId: apto.id, status: "BLOQUEADA" })
    const recente = await certidaoNoProcesso(pb.processoId, "bloq-recente", { tipada: false, responsavelId: apto.id, status: "BLOQUEADA" })
    const semData = await certidaoNoProcesso(pb.processoId, "bloq-sem-data", { tipada: false, responsavelId: apto.id, status: "BLOQUEADA" })
    const bloq = (id: number, dias: number) => prisma.logAuditoria.create({ data: { acao: "TAREFA_BLOQUEADA", entidade: "Tarefa", entidadeId: id, descricao: `${MARCA} bloqueio`, criadoEm: new Date(Date.now() - dias * DIA) } })
    await bloq(antiga.id, 14); await bloq(recente.id, 3)
    await prisma.logAuditoria.create({ data: { acao: "COBRANCA_CLIENTE_BLOQUEIO", entidade: "Tarefa", entidadeId: antiga.id, descricao: `${MARCA} cobrança 1` } })
    await prisma.logAuditoria.create({ data: { acao: "COBRANCA_CLIENTE_BLOQUEIO", entidade: "Tarefa", entidadeId: antiga.id, descricao: `${MARCA} cobrança 2` } })
    itens = await decisoes()
    const bAntiga = itens.find((i) => i.tipo === "BLOQUEADA" && i.tarefaId === antiga.id)
    ok("bloqueada há 14 dias entra, com '2 cobranças ao cliente'", !!bAntiga && /bloqueada há 14 dias · 2 cobranças ao cliente/.test(bAntiga.detalhe), bAntiga?.detalhe ?? "")
    ok("bloqueada há 3 dias NÃO entra (trabalho normal)", !itens.some((i) => i.tipo === "BLOQUEADA" && i.tarefaId === recente.id))
    const bSemData = itens.find((i) => i.tipo === "BLOQUEADA" && i.tarefaId === semData.id)
    ok("sem data de bloqueio registrada: entra e diz 'bloqueio sem data registrada' (nunca inventa)", !!bSemData && /bloqueio sem data registrada/.test(bSemData.detalhe), bSemData?.detalhe ?? "")
    ok("ações: 'Cobrar cliente' e 'Desbloquear'", bAntiga?.acao1.rotulo === "Cobrar cliente" && bAntiga.acao2.rotulo === "Desbloquear")
    const rDes = await acoes.desbloquear(antiga.id, admin.id, `${MARCA} liberado`)
    ok("desbloquear (porta de sempre)", rDes.ok === true && (await prisma.tarefa.findUnique({ where: { id: antiga.id }, select: { statusTarefa: true } }))?.statusTarefa !== "BLOQUEADA")
    const rDesDes = await acoes.desfazerDesbloqueio(antiga.id, admin.id)
    ok("Desfazer o desbloqueio: bloqueia de novo", rDesDes.ok === true && (await prisma.tarefa.findUnique({ where: { id: antiga.id }, select: { statusTarefa: true } }))?.statusTarefa === "BLOQUEADA", JSON.stringify(rDesDes))
    await acoes.desbloquear(antiga.id, admin.id, `${MARCA} liberado de novo`)
    await prisma.tarefa.update({ where: { id: antiga.id }, data: { statusTarefa: "EM_ANDAMENTO" } })
    await prisma.logAuditoria.create({ data: { acao: "TAREFA_PRIORIDADE_ALTERADA", entidade: "Tarefa", entidadeId: antiga.id, descricao: `${MARCA} mexeu depois` } })
    ok("Desfazer o desbloqueio RECUSA quando a tarefa mudou depois", (await acoes.desfazerDesbloqueio(antiga.id, admin.id)).ok === false)

    // ─── FASE DEIXADA ─────────────────────────────────────────────────────────────────────────
    secao("FASE DEIXADA — a fase não tem próxima ação; Avançar fase pela PORTA CANÔNICA")
    const macro = await prisma.macroWorkflow.findFirstOrThrow({ where: { tipoProcessoId: c.tipoId }, select: { id: true } })
    const FASE2 = `${MARCA.toLowerCase()}_fase2`
    await prisma.faseMacro.updateMany({ where: { macroWorkflowId: macro.id, phaseKey: c.PHASE_KEY }, data: { ordem: 0 } })
    await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: FASE2, label: `${MARCA} Fase dois`, ordem: 1, versao: 1, required: true, conditional: false } })
    // A fase de destino precisa de um Workflow Interno publicado (o avanço materializa os passos dela).
    const wf2 = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}-wf2`, phaseKey: FASE2, name: `${MARCA} wf2`, active: true, tipoProcessoId: c.tipoId, escopoExecucao: "PROCESSO" }, select: { id: true } })
    const step2 = await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: wf2.id, key: "passo_dois", label: `${MARCA} Passo dois`, ordem: 1, slaDays: 0, cardinalidade: "PROCESSO" }, select: { id: true } })
    const sub2 = await prisma.stepSubtaskDefinition.create({ data: { stepId: step2.id, key: "fazer", label: "Fazer", ordem: 0, esperaExternaAoLiberar: false, acompanhamentoAtivo: false, dependeDe: [] }, select: { id: true } })
    await prisma.stepAction.create({ data: { stepId: step2.id, subtaskId: sub2.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" } })
    const pub2 = await publicarWorkflow({ workflowId: wf2.id, actorId: null, pularCompetenciaDeEfeito: true })
    ok("o workflow da fase de destino foi publicado (cenário)", pub2.ok === true)
    const pf = await c.novaObrigacao({ responsavelId: apto.id })
    itens = await decisoes()
    ok("processo com tarefa ABERTA na fase atual: NÃO é fase deixada", doProc(itens, pf.processoId, "FASE_DEIXADA").length === 0)
    await prisma.tarefa.update({ where: { id: pf.tarefaId }, data: { statusTarefa: "CONCLUIDO_RECEBIDO", dataConclusao: new Date(Date.now() - 3 * DIA) } })
    itens = await decisoes()
    const fd = doProc(itens, pf.processoId, "FASE_DEIXADA")[0]
    ok("sem tarefa aberta na fase atual → Fase deixada (um item por processo, sem tarefaId)", !!fd && fd.tarefaId == null)
    ok("título: '<família> · <fase> sem próxima ação'", / · .+ sem próxima ação$/.test(fd?.titulo ?? ""), fd?.titulo ?? "")
    ok("detalhe: 'todas as tarefas da fase concluídas há 3 dias · o próximo passo não foi marcado'", /todas as tarefas da fase concluídas há 3 dias · o próximo passo não foi marcado$/.test(fd?.detalhe ?? ""), fd?.detalhe ?? "")
    ok("sugestão: 'Avançar para <próxima fase> e abrir as tarefas dela' — a próxima vem do macro do processo", fd?.sugestao === `Avançar para ${MARCA} Fase dois e abrir as tarefas dela`, fd?.sugestao ?? "")
    ok("ações: 'Avançar fase' e 'Encerrar (não devida)'", fd?.acao1.rotulo === "Avançar fase" && fd.acao1.acao === "AVANCAR_FASE" && fd.acao2.rotulo === "Encerrar (não devida)" && fd.acao2.acao === "ENCERRAR_FASE_NAO_DEVIDA")
    ok("a última fase do macro NÃO tem para onde ir (não é Fase deixada)", doProc(itens, pf.processoId, "FASE_DEIXADA").length === 1 && itens.filter((i) => i.tipo === "FASE_DEIXADA").every((i) => i.contexto.proximaFaseKey))
    const rJust = await acoes.avancarFaseForcado(pf.processoId, "abc", admin.id)
    ok("avançar na marra SEM justificativa de 5 letras: recusa, nada muda", rJust.ok === false && (await prisma.processo.findUnique({ where: { id: pf.processoId }, select: { faseAtualKey: true } }))?.faseAtualKey === c.PHASE_KEY, JSON.stringify(rJust))
    const rAv = await acoes.avancarFase(pf.processoId, admin.id)
    ok("Avançar fase pela porta canônica: ou avança (gate aberto) ou devolve as pendências com 'podeForcar' — nunca escreve a fase por fora",
      rAv.ok === true || (rAv.ok === false && (rAv as { podeForcar?: boolean }).podeForcar === true), JSON.stringify(rAv).slice(0, 300))
    if (!rAv.ok) {
      ok("bloqueado: as pendências vêm com código e mensagem", Array.isArray((rAv as { pendencias?: unknown[] }).pendencias))
      const rF = await acoes.avancarFaseForcado(pf.processoId, `${MARCA} decisão do administrador`, admin.id)
      ok("avançar na marra COM justificativa: avança", rF.ok === true, JSON.stringify(rF).slice(0, 300))
      const log = await prisma.phaseAdvanceLog.findFirst({ where: { processoId: pf.processoId, forcado: true }, orderBy: { id: "desc" } })
      ok("...e fica no histórico como PhaseAdvanceLog FORÇADO, com a justificativa e quem pediu", !!log && log.justificativa?.includes("decisão do administrador") === true && log.solicitadoPorId === admin.id, JSON.stringify(log).slice(0, 200))
    }
    const depois = await prisma.processo.findUnique({ where: { id: pf.processoId }, select: { faseAtualKey: true } })
    ok("o processo está na fase seguinte do macro", depois?.faseAtualKey === FASE2, String(depois?.faseAtualKey))

    secao("FASE DEIXADA — Encerrar (não devida) exige justificativa e vai pelo avanço forçado; processo pausado some")
    const pn = await c.novaObrigacao({ responsavelId: apto.id })
    await prisma.tarefa.update({ where: { id: pn.tarefaId }, data: { statusTarefa: "CONCLUIDO_RECEBIDO", dataConclusao: new Date() } })
    ok("candidato antes de pausar", doProc(await decisoes(), pn.processoId, "FASE_DEIXADA").length === 1)
    await pausarProcesso({ processoId: pn.processoId, usuarioId: admin.id, justificativa: `${MARCA} pausa` })
    ok("processo PAUSADO sai das decisões (filtro canônico da Torre)", doProc(await decisoes(), pn.processoId, "FASE_DEIXADA").length === 0)
    const rCurta = await acoes.encerrarFaseNaoDevida(pn.processoId, "  ", admin.id)
    ok("Encerrar (não devida) sem justificativa: recusa", rCurta.ok === false)

    // ─── CARGA ────────────────────────────────────────────────────────────────────────────────
    secao("CARGA — só move para APTO de fila livre; Redistribuir age no plano que a lista mostra")
    const pesado = await mk("Pesado", EXEC)
    await definirCapacidade({ usuarioId: pesado.id, limiteExecutaveis: 2, autorId: admin.id })
    const pc = await c.novaObrigacao({ responsavelId: pesado.id })
    const c1 = await certidaoNoProcesso(pc.processoId, "carga-1", { tipada: true, responsavelId: pesado.id })
    await prisma.tarefa.update({ where: { id: pc.tarefaId }, data: { statusTarefa: "EM_ANDAMENTO" } })
    itens = await decisoes()
    const carga = itens.find((i) => i.tipo === "CARGA" && i.contexto.usuarioId === pesado.id)
    ok("pessoa no limite aparece em Carga: '<pessoa> · N executáveis (limite 2)'", !!carga && new RegExp(`^${MARCA} Pesado · 2 executáveis \\(limite 2\\)$`).test(carga.titulo), carga?.titulo ?? "")
    ok("detalhe: 'N vencidas · fila …'", /^\d+ vencidas? · fila /.test(carga?.detalhe ?? ""), carga?.detalhe ?? "")
    ok("o item de Carga não tem processo (some quando se escolhe um país — regra do cabeçalho)", carga?.processoId == null && carga?.link === "/torre?aba=equipe")
    ok("ações: 'Redistribuir N' e 'Ver equipe'", /^Redistribuir 1$/.test(carga?.acao1.rotulo ?? "") && carga?.acao2.rotulo === "Ver equipe", `${carga?.acao1.rotulo}`)
    ok("sugestão: 'Mover 1 certidão para <apto> (fila livre)'", new RegExp(`^Mover 1 certidão .*para ${MARCA} Apto \\(fila livre\\)$`).test(carga?.sugestao ?? ""), carga?.sugestao ?? "")
    await definirAptidoes(apto.id, [])
    ok("sem NENHUM apto à unidade: não há para quem mover ('sem pessoa apta…') — nada por chute",
      /sem pessoa apta com fila livre|Nenhuma certidão/.test((await decisoes()).find((i) => i.tipo === "CARGA" && i.contexto.usuarioId === pesado.id)?.sugestao ?? ""))
    ok("...e a ação recusa", (await acoes.redistribuirPorCarga(pesado.id, admin.id)).ok === false)
    await definirAptidoes(apto.id, [perfil.id])
    const rCarga = await acoes.redistribuirPorCarga(pesado.id, admin.id)
    ok("Redistribuir: move a certidão não iniciada para o apto (porta de atribuição, auditada)", rCarga.ok === true && (await prisma.tarefa.findUnique({ where: { id: c1.id }, select: { responsavelId: true } }))?.responsavelId === apto.id, JSON.stringify(rCarga).slice(0, 300))
    ok("a pessoa saiu do limite → a ação não repete", (await acoes.redistribuirPorCarga(pesado.id, admin.id)).ok === false)

    // ─── DIVERGÊNCIA / CADASTRO ───────────────────────────────────────────────────────────────
    secao("DIVERGÊNCIA — tarefa × passo × Central; cadastro nunca entra")
    const pd = await c.novaObrigacao({ responsavelId: apto.id })
    await prisma.phaseWorkflowStepInstance.update({ where: { id: pd.stepInstanceId }, data: { status: "CONCLUIDO" } })
    itens = await decisoes()
    const dv = itens.find((i) => i.tipo === "DIVERGENCIA" && i.tarefaId === pd.tarefaId)
    ok("passo CONCLUIDO × tarefa aberta → Divergência", !!dv)
    ok("detalhe: a tarefa diz X, o passo diz Y, a Central espera Z", /a tarefa diz ".+", o passo diz "concluído", a Central espera "concluída"/.test(dv?.detalhe ?? ""), dv?.detalhe ?? "")
    ok("ações: 'Reconciliar' e 'Ver 3 fontes'", dv?.acao1.rotulo === "Reconciliar" && dv.acao2.rotulo === "Ver 3 fontes")
    ok("a divergência não conta também como Sem responsável", !(await semDonoDoProcesso(pd.processoId, new Date())).includes(pd.tarefaId))
    ok("nenhum item de cadastro (PAREDE_A_FRENTE / CAD-*) nas decisões", itens.every((i) => i.tipo !== "PAREDE_A_FRENTE"))

    // ─── A RESPOSTA ÚNICA ─────────────────────────────────────────────────────────────────────
    secao("A RESPOSTA — resumo por tipo, ordem por risco e o Briefing com números reais")
    const r = await montarPrecisaDeVoce(new Date(), undefined, { nomeDoUsuario: "Marco Rovatti" })
    const soma = Object.values(r.resumo.porTipo).reduce((a, b) => a + b, 0)
    ok("o resumo por tipo fecha com a lista (total = soma dos 6 tipos)", soma === r.itens.length && r.resumo.total === r.itens.length, `${soma}/${r.itens.length}`)
    ok("ordenada por score, maior primeiro", r.itens.every((it, i) => i === 0 || r.itens[i - 1].score >= it.score))
    const soma2 = (m: Record<string, number>) => Object.values(m).reduce((x, y) => x + y, 0)
    ok("a resposta traz o nome de quem lê e o que aconteceu ONTEM por país (o texto do Briefing é montado na tela, com os conjuntos dos cartões)",
      r.nome === "Marco Rovatti" && !("briefing" in r) && typeof r.ontem.fechadas === "object" && typeof r.ontem.protocolados === "object")
    const texto = briefingDoDia(r.itens, new Date(), { nome: r.nome, ativos: 5, noRitmo: 3, fechadasOntem: soma2(r.ontem.fechadas), protocoladosOntem: soma2(r.ontem.protocolados), vencemHoje: 1 })
    ok("o Briefing saúda pelo nome e cita as decisões e os números do dia", /^(Bom dia|Boa tarde|Boa noite), Marco\./.test(texto) && /\d+ (decisões esperam|decisão espera) você/.test(texto) && /5 processos ativos, 3 no ritmo/.test(texto) && /Ontem a equipe fechou/.test(texto) && /Hoje vence 1 prazo/.test(texto), texto)
    ok("o Briefing não inventa o que o sistema não mede (gargalo da semana)", !/Gargalo/i.test(texto))
    const itensTarefa = await itensPrecisaDeVoce({})
    ok("a leitura por TAREFA (Radar, regra r1) continua existindo: itens SEM_DONO por tarefa com tarefaId", itensTarefa.some((i) => i.tipo === "SEM_DONO" && i.tarefaId != null))
  } finally {
    const ids = (await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })).map((p) => p.id)
    await prisma.phaseAdvanceLog.deleteMany({ where: { processoId: { in: ids } } }).catch(() => undefined)
    await prisma.processoPausa.deleteMany({ where: { processoId: { in: ids } } }).catch(() => undefined)
    await prisma.workflowEvento.deleteMany({ where: { processoId: { in: ids } } }).catch(() => undefined)
    await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
    const docs = await prisma.documento.findMany({ where: { descricao: { startsWith: MARCA } }, select: { id: true, pessoaId: true } })
    await prisma.documento.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } })
    await prisma.logAuditoria.deleteMany({ where: { OR: [{ descricao: { contains: MARCA } }, { entidade: "CapacidadeOperacional" }] } })
    await prisma.aptidaoOperacional.deleteMany({ where: { perfilOperacional: { code: { startsWith: MARCA } } } })
    await prisma.capacidadeOperacional.deleteMany({ where: { usuario: { email: { startsWith: MARCA.toLowerCase() } } } })
    await c.limpar().catch((e) => console.log("limpar:", String(e).slice(0, 200)))
    await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: MARCA } } })
    await prisma.perfilOperacionalDocumento.deleteMany({ where: { code: { startsWith: MARCA } } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
