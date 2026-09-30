// scripts/historico-processo-servico.test.ts
// ============================================================================
// HISTÓRICO DO PROCESSO — SERVIÇO + ROTAS (Torre de Controle, seção 4 — 30/09/2026).
//
//   node scripts/ci/gate-build.mjs --so historico-processo-servico      (banco de teste descartável)
//
// Cria eventos REAIS pelas portas do sistema (atribuir em lote · cancelar operação · concluir subtarefa
// como Daniela · ligação ao cartório · comentário) e prova que o histórico os mostra como FATOS redigidos:
//   • atribuição em LOTE agrupada ("atribuiu 4 certidões a Daniela Brait");
//   • validações em sequência pela mesma pessoa agrupadas ("validou 3 certidões de Helena …");
//   • cancelamento com Motivo + Justificativa + Efeito, e "Reabrir" só onde a porta canônica vale;
//   • nenhum "Tarefa concluída" + "Passo concluído" separados, nenhuma linha técnica crua;
//   • escopo por processo, CSV seguro (fórmula neutralizada) e auditado, mesma fonte no Foco da Torre;
//   • "não cresce": mais fatos não multiplicam as consultas (depois <= antes + 2).
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("historico-processo-servico.test.ts")

import { NextRequest } from "next/server"
import { PrismaClient } from "@prisma/client"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario, type SubtarefaDaFixture } from "./_fixture-torre-gh"
import { historicoDoProcesso } from "../src/services/historico-processo"
import { atribuirEmLote } from "../src/services/torre-acoes-lote"
import { controlarOperacaoV2 } from "../src/services/documento-operacao"
import { concluirSubtarefaCorrentePeloPasso } from "../src/services/subtarefas-da-etapa"
import { registrarLigacao } from "../src/services/precisa-de-voce-acoes"
import { garantirNecessidade } from "../src/services/necessidade-documental"
import { criarComentario } from "../src/services/comentario-tarefa"
import { montarVisao, FILTROS_LIMPOS, FILTROS_PADRAO } from "../lib/operacional/historico-filtros"
import { GET as getHistorico, POST as postHistorico } from "../src/app/api/processos/[processoId]/historico/route"
import { GET as getHistoricoFoco } from "../src/app/api/torre/foco/[processoId]/historico/route"
import { POST as postReabrir } from "../src/app/api/processos/[processoId]/reabrir-certidao/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "HISTSVC"
const req = (method: string, url: string, token: string | null, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })

/** As 4 subtarefas REAIS da Emissão Documental (as chaves que o histórico reconhece por papel). */
const SUBS: SubtarefaDaFixture[] = [
  { key: "enviar_requerimento_cartorio", label: "Enviar requerimento ao cartório", ordem: 0, espera: false, dependeDe: [] },
  { key: "receber_confirmacao_pedido", label: "Receber confirmação do pedido", ordem: 1, espera: true, dependeDe: ["enviar_requerimento_cartorio"] },
  { key: "receber_certidao", label: "Receber certidão", ordem: 2, espera: true, dependeDe: ["receber_confirmacao_pedido"] },
  { key: "conferir_validar_certidao", label: "Conferir e validar certidão", ordem: 3, espera: false, dependeDe: ["receber_certidao"] },
]

/** Conta as idas ao banco de UMA leitura do histórico (cliente próprio, instrumentado). */
async function contarConsultas(processoId: number): Promise<number> {
  const espiao = new PrismaClient({ log: [{ emit: "event", level: "query" }] })
  let n = 0
  ;(espiao as unknown as { $on: (e: string, cb: () => void) => void }).$on("query", () => { n++ })
  try { await historicoDoProcesso(processoId, { db: espiao }) } finally { await espiao.$disconnect() }
  return n
}

async function main() {
  const c = await montarCenario(MARCA, { subs: SUBS })
  const usuariosCriados: number[] = []
  try {
    const mk = async (nome: string, tipo: string, perms?: Record<string, boolean>) => {
      const u = await prisma.usuario.create({ data: { nome, email: `${MARCA.toLowerCase()}-${nome.split(" ")[0].toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
      usuariosCriados.push(u.id)
      return u
    }
    const marco = await mk("Marco Rovatti", "admin")
    const daniela = await mk("Daniela Brait", "assistente", { "processos.ver": true, "tarefas.ver": true, "tarefas.editar": true })
    const visitante = await mk("Visitante Sem Acesso", "assistente", { "processos.ver": false })
    const tMarco = await tokenDe(marco), tDaniela = await tokenDe(daniela), tVisitante = await tokenDe(visitante)

    // ── CENÁRIO: um processo, cinco certidões (3 de Helena, 1 de Maria, 1 de Maria com justificativa maliciosa) ──
    secao("Cenário — cinco certidões no MESMO processo, criadas pelo motor")
    const obs: Awaited<ReturnType<typeof c.novaObrigacao>>[] = []
    for (let i = 0; i < 5; i++) obs.push(await c.novaObrigacao({ comSolicitacao: { canal: "CRC" } }))
    const P = obs[0].processoId
    const arvoreId = (await prisma.processo.findUniqueOrThrow({ where: { id: P }, select: { arvoreId: true } })).arvoreId as number
    const helena = await prisma.pessoa.create({ data: { arvoreId, nome: "Helena", sobrenome: "Peres Nás", linhaReta: true, requerente: "nao" }, select: { id: true } })
    const maria = await prisma.pessoa.create({ data: { arvoreId, nome: "Maria", sobrenome: "del Consuelo", linhaReta: true, requerente: "nao" }, select: { id: true } })
    const donos = [helena.id, helena.id, helena.id, maria.id, maria.id]
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i]
      await prisma.tarefa.update({ where: { id: o.tarefaId }, data: { processoId: P, pessoaId: donos[i], titulo: `Certidão de casamento - Inteiro Teor · ${i < 3 ? "Helena Peres Nás" : "Maria del Consuelo"}`, faseMacroKey: c.PHASE_KEY } })
      await prisma.phaseWorkflowStepInstance.update({ where: { id: o.stepInstanceId }, data: { processoId: P, documentoId: o.documentoId } })
      await prisma.documento.update({ where: { id: o.documentoId as number }, data: { pessoaId: donos[i] } })
      await prisma.solicitacaoDocumento.updateMany({ where: { tarefaId: o.tarefaId }, data: { processoId: P, pessoaId: donos[i], criadoPorId: daniela.id, destinatarioNome: "Santos - 1º Subdistrito" } })
    }
    // Um processo SEPARADO, com um fato próprio: nunca pode aparecer no histórico de P (escopo por identidade).
    const outro = await c.novaObrigacao({})
    await criarComentario({ tarefaId: outro.tarefaId, autorId: marco.id, texto: "comentário de OUTRO processo" })

    // A certidão 5 nasce de uma EXIGÊNCIA (necessidade) — como na Emissão real: cancelar a operação dispensa a necessidade.
    const item = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_ITEM`, name: "Certidão de casamento", natureza: "DOCUMENTO" }, select: { id: true } })
    const nec = (await garantirNecessidade({ processoId: P, itemCatalogoId: item.id, pessoaId: maria.id, ciclo: 1 })).necessidade
    await prisma.documento.update({ where: { id: obs[4].documentoId as number }, data: { necessidadeId: nec.id } })
    await prisma.tarefa.update({ where: { id: obs[4].tarefaId }, data: { necessidadeId: nec.id } })

    // 1) Marco atribui as 5 à Daniela, em lote (a porta da Torre).
    const lote = await atribuirEmLote({ tarefaIds: obs.map((o) => o.tarefaId), responsavelId: daniela.id, autorId: marco.id })
    ok("lote: 5 tarefas atribuídas pela porta real", lote.sucesso === 5, JSON.stringify({ s: lote.sucesso, f: lote.falha }))

    // 2) Daniela liga ao cartório sobre a certidão 4 (ainda na 1ª subtarefa) e Marco comenta nela.
    const lig = await registrarLigacao(obs[3].tarefaId, daniela.id, "cartório pediu para ligar amanhã", "EM_BUSCA")
    ok("ligação registrada pela porta real", lig.ok === true, JSON.stringify(lig))
    await criarComentario({ tarefaId: obs[3].tarefaId, autorId: marco.id, texto: "Certidão difícil: cartório pequeno." })

    // 3) Daniela conclui as 4 subtarefas das certidões 1–3 (enviar → confirmar → receber → validar).
    for (const o of obs.slice(0, 3)) {
      for (let k = 0; k < 4; k++) await concluirSubtarefaCorrentePeloPasso({ stepInstanceId: o.stepInstanceId, executadoPorId: daniela.id, payload: {} })
    }
    const concluidas = await prisma.subtaskExecution.count({ where: { stepInstanceId: { in: obs.slice(0, 3).map((o) => o.stepInstanceId) }, completedAt: { not: null }, executadoPorId: daniela.id } })
    ok("subtarefas concluídas pela porta real como Daniela (3 certidões × 4 subtarefas)", concluidas === 12, String(concluidas))
    // 4) Marco cancela a certidão 4 (pela porta "Cancelar operação") — com a observação composta do modal.
    const ctxOp = { usuarioId: marco.id, permissoes: { "tarefas.excluir": true, "workflow.iniciarPasso": true, "tarefas.bloquear": true }, isAdmin: true } as never
    const cancel = await controlarOperacaoV2(obs[3].documentoId as number, "cancelar", "Motivo: Documento não necessário · Justificativa: Não trava o avanço do processo", ctxOp)
    ok("cancelar operação pela porta real", (cancel as { ok: boolean }).ok === true, JSON.stringify(cancel).slice(0, 160))
    // 5) Marco cancela a certidão 5 com justificativa MALICIOSA (fórmula de planilha) — o CSV precisa neutralizá-la.
    const cancel2 = await controlarOperacaoV2(obs[4].documentoId as number, "cancelar", "Motivo: Outro motivo · Justificativa: =HYPERLINK(\"http://evil\",\"x\")", ctxOp)
    ok("segundo cancelamento", (cancel2 as { ok: boolean }).ok === true)
    // 6) Linhas técnicas que o motor grava de verdade: nenhuma pode aparecer crua.
    const t0 = new Date(Date.now() - 1000)
    await prisma.logAuditoria.createMany({
      data: [
        { acao: "TAREFA_REANCORADA", entidade: "Tarefa", entidadeId: obs[0].tarefaId, descricao: "Tarefa X seguiu o trabalho para a fase genealogia", detalhes: { tarefaId: obs[0].tarefaId }, criadoEm: t0 },
        { acao: "registral_linhagem_recalculada", entidade: "Processo", entidadeId: P, descricao: "Linhagem recalculada: LINHA_COMPLETA_COMPROVADA · 5 inconsistência(s) · motivo=documento_alterado", detalhes: {}, criadoEm: t0 },
        { acao: "registral_linhagem_recalculada", entidade: "Processo", entidadeId: P, descricao: "Linhagem recalculada: LINHA_COMPLETA_COMPROVADA · 5 inconsistência(s) · motivo=documento_alterado", detalhes: {}, criadoEm: new Date(t0.getTime() + 500) },
        { acao: "FASE_MATERIALIZADA", entidade: "PROCESSO", entidadeId: P, descricao: "Materialização da fase Genealogia (ciclo 1) — MATERIALIZADO", detalhes: { ciclo: 1, estado: "MATERIALIZADO", escopo: "NECESSIDADE", faseMacroKey: c.PHASE_KEY, passosTotais: 13 }, criadoEm: t0 },
      ],
    })

    // ════════════ AS FRASES ════════════
    secao("Os fatos — um registro por FATO REAL, em frase completa")
    const h = (await historicoDoProcesso(P))!
    console.log(h.fatos.map((f) => `   ${f.automatico ? "[auto] " : ""}${f.frase}`).join("\n"))
    const todasAsFrases = h.fatos.flatMap((f) => [f.frase, ...f.agrupadoDe.map((i) => i.frase)])

    const gLote = h.fatos.find((f) => f.subtipo === "atribuida")
    ok("atribuição em LOTE agrupada: 'Marco Rovatti atribuiu 5 certidões a Daniela Brait'", gLote?.quantidade === 5 && gLote.quem.nome === "Marco Rovatti" && /^Marco Rovatti atribuiu 5 certidões a Daniela Brait/.test(gLote.frase), gLote?.frase)
    ok("o lote guarda as 5 (Ver as 5): cada item com a sua certidão", gLote?.agrupadoDe.length === 5 && gLote.agrupadoDe.every((i) => i.links.tarefaId != null))

    const gVal = h.fatos.find((f) => f.subtipo === "validada")
    ok("validações em sequência pela mesma pessoa e pessoa agrupam: 'Daniela Brait validou 3 certidões de Helena Peres Nás'", gVal?.quantidade === 3 && /^Daniela Brait validou 3 certidões de Helena Peres Nás/.test(gVal.frase) && gVal.agrupadoDe.length === 3, gVal?.frase)
    ok("(nenhuma outra validação: a certidão da Maria não foi validada)", h.fatos.filter((f) => f.subtipo === "validada").length === 1)
    const gRec = h.fatos.find((f) => f.subtipo === "recebida")
    ok("recebimentos também agrupam por pessoa", gRec?.quantidade === 3 && /recebeu 3 certidões de Helena Peres Nás/.test(gRec.frase))
    const solic = h.fatos.filter((f) => f.subtipo === "solicitada")
    ok("pedido ao cartório: 'Daniela Brait solicitou a Certidão … a Santos - 1º Subdistrito por CRC' (um por certidão, com quem/canal/destino)", solic.length >= 3 && solic.every((f) => f.quem.nome === "Daniela Brait" && /a Santos - 1º Subdistrito por CRC/.test(f.frase)), solic[0]?.frase)

    const cancelados = h.fatos.filter((f) => f.subtipo === "cancelada")
    const fc = cancelados.find((f) => f.justificativa === "Não trava o avanço do processo")
    ok("cancelamento: hora · quem · certidão e de quem · fase/passo", !!fc && fc.quem.nome === "Marco Rovatti" && /^Marco Rovatti cancelou a Certidão de casamento - Inteiro Teor · Maria del Consuelo/.test(fc.frase), fc?.frase)
    ok("cancelamento: Motivo e Justificativa separados do texto composto do modal", fc?.motivo === "Documento não necessário" && fc.justificativa === "Não trava o avanço do processo" && /Motivo: Documento não necessário\. Justificativa: “Não trava o avanço do processo”/.test(fc.frase))
    ok("cancelamento: Efeito (saiu de A iniciar do responsável; continua na pasta como Cancelada)", /saiu de “A iniciar” \(responsável: Daniela Brait\)/.test(fc?.efeito ?? "") && /continua na pasta como Cancelada/.test(fc?.efeito ?? ""), fc?.efeito ?? "")
    ok("cancelamento: traz o link da certidão (tarefa) e da pessoa", fc?.links.tarefaId === obs[3].tarefaId && fc.links.documentoId === obs[3].documentoId && fc.links.pessoaId === maria.id)
    ok("cancelamento: 'Reabrir certidão' só aparece quando a tarefa continua CANCELADA (porta canônica `reabrir`)", fc?.reabrivel?.tarefaId === obs[3].tarefaId)
    ok("dois cancelamentos = DOIS cartões (cada decisão tem o seu motivo e o seu Reabrir — não agrupam)", cancelados.length === 2 && cancelados.every((f) => f.quantidade === 1))

    const ligacao = h.fatos.find((f) => f.subtipo === "cobranca")
    ok("ligação ao cartório vira fato: 'Daniela Brait ligou para o cartório … — telefone, em busca'", !!ligacao && ligacao.quem.nome === "Daniela Brait" && /ligou para o cartório/.test(ligacao.frase) && /em busca/.test(ligacao.frase) && ligacao.justificativa === "cartório pediu para ligar amanhã", ligacao?.frase)
    const coment = h.fatos.find((f) => f.subtipo === "comentario" && f.quem.nome === "Marco Rovatti")
    ok("comentário vira fato, na certidão certa", !!coment && /comentou na Certidão de casamento - Inteiro Teor · Maria del Consuelo/.test(coment.frase) && /Certidão difícil/.test(coment.frase), coment?.frase)

    secao("O que NUNCA aparece")
    ok("'Tarefa concluída' + 'Passo concluído' separados para o mesmo fato: não existem", !h.fatos.some((f) => f.subtipo === "tarefa_concluida" || f.subtipo === "etapa_concluida") && !todasAsFrases.some((t) => /Tarefa conclu[ií]da|Passo conclu[ií]do|Etapa conclu[ií]da/i.test(t)))
    ok("'Materialização (ciclo 1) — MATERIALIZADO' cru: não aparece", !todasAsFrases.some((t) => /Materializa[cç][aã]o \(ciclo|MATERIALIZADO/.test(t)))
    ok("'registral_linhagem_recalculada' cru: não aparece", !todasAsFrases.some((t) => /registral_|linhagem_recalculada/.test(t)))
    ok("nenhum código técnico em CAIXA_ALTA nas frases", !todasAsFrases.some((t) => /\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/.test(t)), todasAsFrases.find((t) => /\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/.test(t)))
    ok("TAREFA_REANCORADA (mecânica interna) é descartada e contada, não mostrada", (h.descartados["Tarefa:TAREFA_REANCORADA"] ?? 0) >= 1)
    ok("toda linha que o motor gravou tem destino conhecido (nada em 'naoClassificados')", Object.keys(h.naoClassificados).length === 0, JSON.stringify(h.naoClassificados))
    ok("escopo: o comentário do OUTRO processo não aparece", !todasAsFrases.some((t) => /OUTRO processo/.test(t)))
    ok("HISTORICO_EXPORTADO nunca vira fato", !h.fatos.some((f) => /exportad/i.test(f.frase)))

    secao("Técnico vira linha legível e fica sob 'automáticos'")
    const aut = h.fatos.filter((f) => f.automatico)
    const lin = h.fatos.find((f) => f.subtipo === "linhagem")
    ok("linhagem recalculada vira UMA linha legível (duas seguidas agrupadas)", lin?.quantidade === 2 && lin.automatico && lin.frase === "Sistema recalculou a linhagem da árvore 2 vezes", lin?.frase)
    const prep = h.fatos.find((f) => f.subtipo === "preparo_fase")
    ok("'Sistema preparou a fase … com 13 certidões (a partir da árvore)'", !!prep && prep.automatico && /^Sistema preparou a fase( .+)? com 13 certidões \(a partir da árvore\)$/.test(prep.frase), prep?.frase)
    ok("esperas de cartório decididas pelo motor são automáticas e não dizem que o prazo pausou", aut.filter((f) => f.subtipo === "espera_terceiro").every((f) => !/paus/i.test(f.frase)))
    const padrao = montarVisao(h.fatos, FILTROS_PADRAO, new Date(h.geradoEm))
    ok("por padrão os automáticos ficam ocultos, com contador", padrao.automaticosOcultos === aut.length && padrao.visiveis.every((f) => !f.automatico) && padrao.mostrando === h.fatos.length - aut.length)
    const todos = montarVisao(h.fatos, FILTROS_LIMPOS, new Date(h.geradoEm))
    ok("'mostrar' revela todos: Mostrando N de M com N = M", todos.mostrando === todos.total && todos.total === h.fatos.length)

    // ════════════ ROTAS ════════════
    secao("Rotas — permissão, escopo, CSV seguro e auditado, mesma fonte no Foco")
    const r401 = await getHistorico(req("GET", `/api/processos/${P}/historico`, null), ctx({ processoId: String(P) }))
    ok("sem token: 401", r401.status === 401)
    const r403 = await getHistorico(req("GET", `/api/processos/${P}/historico`, tVisitante), ctx({ processoId: String(P) }))
    ok("sem processos.ver: 403", r403.status === 403)
    ok("processo inexistente: 404 · id inválido: 400",
      (await getHistorico(req("GET", "/api/processos/99999999/historico", tMarco), ctx({ processoId: "99999999" }))).status === 404
      && (await getHistorico(req("GET", "/api/processos/x/historico", tMarco), ctx({ processoId: "x" }))).status === 400)
    const rOk = await getHistorico(req("GET", `/api/processos/${P}/historico`, tDaniela), ctx({ processoId: String(P) }))
    const corpo = await rOk.json()
    ok("Daniela (processos.ver) lê: 200, mesmos fatos do serviço", rOk.status === 200 && corpo.fatos.length === h.fatos.length)
    ok("Daniela tem tarefas.editar ⇒ 'reabrir' liberado; o visitante nem entra", corpo.permissoes.reabrir === true)
    const foco = await getHistoricoFoco(req("GET", `/api/torre/foco/${P}/historico`, tMarco), ctx({ processoId: String(P) }))
    const corpoFoco = await foco.json()
    ok("Foco da família (Torre): a MESMA lista de fatos da aba", foco.status === 200 && JSON.stringify(corpoFoco.fatos.map((f: { id: string }) => f.id)) === JSON.stringify(corpo.fatos.map((f: { id: string }) => f.id)))
    ok("Foco da família: quem não é gestor da Torre leva 403", (await getHistoricoFoco(req("GET", `/api/torre/foco/${P}/historico`, tDaniela), ctx({ processoId: String(P) }))).status === 403)

    const antesExport = await prisma.logAuditoria.count({ where: { acao: "HISTORICO_EXPORTADO", entidadeId: P } })
    const csvRes = await getHistorico(req("GET", `/api/processos/${P}/historico?formato=csv&periodo=todo`, tMarco), ctx({ processoId: String(P) }))
    const bytes = new Uint8Array(await csvRes.clone().arrayBuffer())
    const csv = await csvRes.text()
    ok("CSV: 200, text/csv, anexo, BOM nos bytes", csvRes.status === 200 && /text\/csv/.test(csvRes.headers.get("content-type") ?? "") && /attachment; filename="historico-.*\.csv"/.test(csvRes.headers.get("content-disposition") ?? "") && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    ok("CSV: UMA linha por cartão do recorte (todo o período, automáticos incluídos) + cabeçalho", csv.split("\r\n").filter(Boolean).length === h.fatos.length + 1 && csv.startsWith('"Quando";"Quem";"Tipo";"Fato"'))
    ok("CSV: a justificativa maliciosa (=HYPERLINK) sai neutralizada com apóstrofo", csv.includes(`"'=HYPERLINK(`) && !/;"=HYPERLINK/.test(csv))
    const csvFiltrado = await (await getHistorico(req("GET", `/api/processos/${P}/historico?formato=csv&periodo=todo&tipo=ATRIBUICAO`, tMarco), ctx({ processoId: String(P) }))).text()
    ok("CSV respeita o filtro (só Atribuição: cabeçalho + 1 cartão de lote)", csvFiltrado.split("\r\n").filter(Boolean).length === 2)
    const csvAuto = await (await getHistorico(req("GET", `/api/processos/${P}/historico?formato=csv&periodo=todo&ocultarAutomaticos=1`, tMarco), ctx({ processoId: String(P) }))).text()
    ok("CSV com 'Ocultar automáticos' não traz as linhas do Sistema", !/;"Sistema";/.test(csvAuto))
    ok("cada exportação fica auditada (quem, filtros, quantas linhas) — e não vira fato", (await prisma.logAuditoria.count({ where: { acao: "HISTORICO_EXPORTADO", entidadeId: P } })) === antesExport + 3)
    const pdf = await postHistorico(req("POST", `/api/processos/${P}/historico`, tMarco, { formato: "pdf", filtros: "periodo=7d", linhas: 7 }), ctx({ processoId: String(P) }))
    ok("PDF: o navegador desenha e registra a exportação pela rota (auditada)", pdf.status === 200 && (await prisma.logAuditoria.count({ where: { acao: "HISTORICO_EXPORTADO", entidadeId: P, descricao: { contains: "PDF" } } })) === 1)
    ok("POST com formato inválido: 400 · sem token: 401",
      (await postHistorico(req("POST", `/api/processos/${P}/historico`, tMarco, { formato: "xml" }), ctx({ processoId: String(P) }))).status === 400
      && (await postHistorico(req("POST", `/api/processos/${P}/historico`, null, { formato: "pdf" }), ctx({ processoId: String(P) }))).status === 401)

    // ════════════ "NÃO CRESCE" ════════════
    secao("Consultas: mais fatos não multiplicam as idas ao banco (depois <= antes + 2)")
    const antes = await contarConsultas(P)
    for (let i = 0; i < 12; i++) await criarComentario({ tarefaId: obs[0].tarefaId, autorId: marco.id, texto: `comentário extra ${i}` })
    await prisma.logAuditoria.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ acao: "TAREFA_PRAZO_ALTERADO", entidade: "Tarefa", entidadeId: obs[1].tarefaId, descricao: `${MARCA} prazo ${i}`, detalhes: { de: "2026-10-01T12:00:00.000Z", para: "2026-10-05T12:00:00.000Z", motivo: `motivo ${i}` }, usuarioId: marco.id })) })
    const hDepois = await historicoDoProcesso(P)
    const depois = await contarConsultas(P)
    ok("o histórico cresceu (fatos novos de comentário e prazo)", hDepois!.fatos.length > h.fatos.length, `${h.fatos.length} → ${hDepois!.fatos.length}`)
    ok("consultas: depois <= antes + 2 (nenhum N+1 por fato)", depois <= antes + 2, `${antes} → ${depois}`)

    // ════════════ REABRIR ════════════
    secao("Reabrir certidão — desfaz o cancelamento INTEIRO (documento, exigência, etapas, tarefa), na porta própria")
    const reabrir = (tarefaId: number, motivo: string, token: string | null = tDaniela, processoId = P) =>
      postReabrir(req("POST", `/api/processos/${processoId}/reabrir-certidao`, token, { tarefaId, motivo }), ctx({ processoId: String(processoId) }))
    ok("sem token: 401 · sem tarefas.editar: 403", (await reabrir(obs[3].tarefaId, "cancelamento indevido", null)).status === 401 && (await reabrir(obs[3].tarefaId, "cancelamento indevido", tVisitante)).status === 403)
    ok("motivo obrigatório (mín. 5 caracteres): 422", (await reabrir(obs[3].tarefaId, "ok")).status === 422)
    ok("escopo: a tarefa de OUTRO processo não se reabre por este processo: 404", (await reabrir(outro.tarefaId, "cancelamento indevido")).status === 404)
    ok("tarefa que NÃO está cancelada: 409", (await reabrir(obs[0].tarefaId, "cancelamento indevido")).status === 409)
    // A certidão NÃO EXIGIDA pela árvore não tem botão: quem decide é a árvore.
    const naoExigida = await c.novaObrigacao({ comSolicitacao: { canal: "CRC" } })
    await prisma.tarefa.update({ where: { id: naoExigida.tarefaId }, data: { processoId: P, statusTarefa: "CANCELADA" } })
    await prisma.documento.update({ where: { id: naoExigida.documentoId as number }, data: { status: "NAO_EXIGIDO" } })
    const rNE = await reabrir(naoExigida.tarefaId, "cancelamento indevido")
    ok("NÃO EXIGIDA pela árvore: recusa (409 NAO_EXIGIDA_PELA_ARVORE) e diz por quê", rNE.status === 409 && (await rNE.json()).codigo === "NAO_EXIGIDA_PELA_ARVORE")

    const antesDoc = await prisma.documento.findUniqueOrThrow({ where: { id: obs[4].documentoId as number }, select: { status: true } })
    const antesNec = await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: nec.id }, select: { status: true } })
    ok("(antes) cancelada a operação: documento CANCELADO e exigência DISPENSADA", antesDoc.status === "CANCELADO" && antesNec.status === "DISPENSADA", `${antesDoc.status}/${antesNec.status}`)
    for (const alvo of [obs[3], obs[4]]) {
      const r = await reabrir(alvo.tarefaId, "cancelamento indevido — a certidão é necessária")
      ok(`reabrir pela porta: 200 (tarefa ${alvo.tarefaId})`, r.status === 200 && (await r.json()).modo === "OPERACAO")
      const t = await prisma.tarefa.findUniqueOrThrow({ where: { id: alvo.tarefaId }, select: { statusTarefa: true } })
      const d = await prisma.documento.findUniqueOrThrow({ where: { id: alvo.documentoId as number }, select: { status: true, motivoBloqueio: true } })
      const passos = await prisma.phaseWorkflowStepInstance.findMany({ where: { documentoId: alvo.documentoId as number }, select: { status: true } })
      ok("  a MESMA tarefa voltou ao trabalho (não cancelada), documento PENDENTE e etapas reabertas — estado coerente", t.statusTarefa !== "CANCELADA" && d.status === "PENDENTE" && d.motivoBloqueio === null && passos.every((p) => p.status !== "CANCELADO"), `tarefa=${t.statusTarefa} doc=${d.status} passos=${passos.map((p) => p.status).join(",")}`)
    }
    ok("a exigência (necessidade) voltou a PENDENTE", (await prisma.necessidadeDocumental.findUniqueOrThrow({ where: { id: nec.id }, select: { status: true } })).status === "PENDENTE")
    ok("reabrir de novo: 409 (já não está cancelada)", (await reabrir(obs[3].tarefaId, "cancelamento indevido")).status === 409)
    const hRe = (await historicoDoProcesso(P))!
    const fRe = hRe.fatos.filter((f) => f.subtipo === "reaberta")
    console.log(fRe.map((f) => `   ${f.frase}`).join("\n"))
    ok("a reabertura entra no histórico: quem · a certidão · Motivo", fRe.length === 2 && fRe.every((f) => f.quem.nome === "Daniela Brait" && /^Daniela Brait reabriu a Certidão de casamento - Inteiro Teor · Maria del Consuelo/.test(f.frase) && /Motivo: cancelamento indevido — a certidão é necessária/.test(f.frase)))
    ok("e os cancelamentos anteriores deixam de oferecer 'Reabrir'", hRe.fatos.filter((f) => f.subtipo === "cancelada").every((f) => f.reabrivel === null))
    ok("nada técnico vaza nem depois de reabrir (naoClassificados vazio)", Object.keys(hRe.naoClassificados).length === 0, JSON.stringify(hRe.naoClassificados))
  } finally {
    await prisma.logAuditoria.deleteMany({ where: { OR: [{ usuarioId: { in: usuariosCriados } }, { descricao: { contains: MARCA } }] } })
    await prisma.comentarioTarefa.deleteMany({ where: { autorId: { in: usuariosCriados } } })
    await c.limpar()   // apagar o processo leva junto a exigência (cascata); só então o item do catálogo fica sem uso
    await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
