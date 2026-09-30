// scripts/torre-bloco-i-integridade-auditoria-foco.test.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO I (30/09/2026) — Integridade, Auditoria e Foco da família.
//
//   npx tsx scripts/torre-bloco-i-integridade-auditoria-foco.test.ts   (banco de teste)
//
// PROVA:
//   I1  a Integridade lê o MESMO motor do Saúde (SaudeAchado), ordena CRÍTICO→ERRO→ALERTA→INFORMATIVO (o CAD-011
//       fica visível, depois dos erros), "Ignorar 7 d" grava quem/quando/até quando + auditoria e, vencido o prazo,
//       o achado VOLTA (conferido na leitura);
//   I2  a Auditoria pagina e filtra no servidor, o CSV é o MESMO recorte, só administrador, e é auditado;
//   I3  o Foco: os 4 números BATEM com a aba Tarefas; tabela = linhas da Operação; linha do tempo do banco.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bloco-i-integridade-auditoria-foco.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { achadosAbertos } from "../lib/saude"
import { quadroDeIntegridade } from "../lib/operacional/torre-integridade"
import { consultarAuditoria, csvDaAuditoria } from "../lib/operacional/torre-auditoria"
import { focoDaFamilia, numerosDoFoco } from "../lib/operacional/torre-foco"
import { historicoDoProcesso } from "../src/services/historico-processo"
import { GET as getFocoHistorico } from "../src/app/api/torre/foco/[processoId]/historico/route"
import { progressoRealDoProcesso } from "../lib/operacional/metricas-processo"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { registrarLigacao } from "../src/services/precisa-de-voce-acoes"
import { GET as getIntegridade } from "../src/app/api/torre/integridade/route"
import { POST as postIgnorar } from "../src/app/api/torre/integridade/ignorar/route"
import { GET as getAuditoria } from "../src/app/api/torre/auditoria/route"
import { GET as getCsv } from "../src/app/api/torre/auditoria/csv/route"
import { GET as getFoco } from "../src/app/api/torre/foco/[processoId]/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREI1"
const DIA = 86_400_000
const req = (method: string, url: string, token: string | null, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })

async function main() {
  const c = await montarCenario(MARCA)
  try {
    const mk = (nome: string, tipo: string, perms?: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const admin = await mk("Admin", "admin")
    const outro = await mk("Outro", "admin")
    const gestor = await mk("Gestor", "assistente", { "tarefas.ver": true, "operacao.distribuirTarefas": true })
    const tAdmin = await tokenDe(admin), tGestor = await tokenDe(gestor)

    // ════════════ I1 — INTEGRIDADE ════════════
    secao("I1 — a Integridade lê o MESMO motor do Saúde")
    const agora = new Date()
    const mkAchado = (chave: string, severidade: string, extra: Record<string, unknown> = {}) =>
      prisma.saudeAchado.create({ data: { chave: `${MARCA}::${chave}`, codigo: (extra.codigo as string) ?? "TST-001", dominio: "BANCO", modulo: "teste", severidade, titulo: `${MARCA} ${chave}`, descricao: `descrição ${chave}`, impacto: `efeito ${chave}`, versaoCatalogo: "t", ...extra } as never })
    const info = await mkAchado("info", "INFORMATIVO", { codigo: "CAD-011" })
    const alerta = await mkAchado("alerta", "ALERTA")
    const erro = await mkAchado("erro", "ERRO", { correcaoAutomatica: "reprocessar-outbox", link: "/administrator?screen=fases", recomendacao: "corrija" })
    const critico = await mkAchado("critico", "CRITICO", { correcaoAutomatica: "nao-existe-no-catalogo" })
    const ignVigente = await mkAchado("ign-vigente", "ERRO", { status: "IGNORADO", ignoradoAte: new Date(agora.getTime() + 3 * DIA), ignoradoPorId: admin.id, justificativa: "vou olhar depois" })
    const ignVencido = await mkAchado("ign-vencido", "ALERTA", { status: "IGNORADO", ignoradoAte: new Date(agora.getTime() - DIA), ignoradoPorId: admin.id })
    await mkAchado("resolvido", "CRITICO", { status: "RESOLVIDO", resolvidoEm: agora })

    const q = await quadroDeIntegridade(agora)
    const meus = q.itens.filter((i) => i.chave.startsWith(MARCA))
    const idsMotor = new Set((await achadosAbertos()).map((a) => a.id))
    ok("cada item é um SaudeAchado do motor (nenhuma lista paralela)", [...q.itens, ...q.itensIgnorados].every((i) => idsMotor.has(i.id)))
    ok("o resolvido não aparece", ![...q.itens, ...q.itensIgnorados].some((i) => i.chave.endsWith("resolvido")))
    ok("a ordem é CRÍTICO → ERRO → ALERTA → INFORMATIVO (o informativo, CAD-011, fica por último e VISÍVEL)",
      meus.map((i) => i.severidade).join(",").replace(/(ALERTA,)+/g, "ALERTA,") === "CRITICO,ERRO,ALERTA,ALERTA,INFORMATIVO" || (meus.findIndex((i) => i.severidade === "INFORMATIVO") === meus.length - 1
        && meus.findIndex((i) => i.severidade === "CRITICO") < meus.findIndex((i) => i.severidade === "ERRO")
        && meus.findIndex((i) => i.severidade === "ERRO") < meus.findIndex((i) => i.severidade === "ALERTA")), meus.map((i) => i.severidade).join(","))
    ok("o informativo aparece na lista (não é escondido)", meus.some((i) => i.id === info.id && i.codigo === "CAD-011"))
    ok("achado + efeito + ação de correção ao lado", meus.find((i) => i.id === erro.id)!.efeito === "efeito erro" && meus.find((i) => i.id === erro.id)!.acao.link === "/administrator?screen=fases" && meus.find((i) => i.id === erro.id)!.acao.recomendacao === "corrija")
    ok("correção automática só aparece se existe no catálogo de correções seguras", meus.find((i) => i.id === erro.id)!.acao.correcao?.id === "reprocessar-outbox" && meus.find((i) => i.id === critico.id)!.acao.correcao === null)
    ok("ignorado com prazo no futuro sai da lista e vai para os ignorados (com quem e até quando)", !q.itens.some((i) => i.id === ignVigente.id) && q.itensIgnorados.some((i) => i.id === ignVigente.id && i.ignorado?.por === `${MARCA} Admin` && i.ignorado.justificativa === "vou olhar depois"))
    ok("ignorado com prazo VENCIDO volta para a lista, marcado", q.itens.some((i) => i.id === ignVencido.id && i.voltouDeIgnorado === true && i.status === "ABERTO"))
    ok("divergências = críticos+erros+alertas vivos (sem informativos nem ignorados vigentes)", q.divergencias === q.itens.filter((i) => i.severidade !== "INFORMATIVO").length)
    ok("a frase do topo", q.frase === "O sistema se vigia. Meta: divergências = 0.")
    ok("gestor sem usuarios.gerenciar: 403", (await getIntegridade(req("GET", "/api/torre/integridade", tGestor))).status === 403)
    ok("sem token: 401", (await getIntegridade(req("GET", "/api/torre/integridade", null))).status === 401)
    const rota = await (await getIntegridade(req("GET", "/api/torre/integridade", tAdmin))).json()
    ok("a rota devolve o mesmo quadro", rota.itens.length === q.itens.length)

    secao("I1 — IGNORAR 7 d: quem, quando, até quando, auditado")
    ok("sem justificativa: 400", (await postIgnorar(req("POST", "/api/torre/integridade/ignorar", tAdmin, { achadoId: alerta.id, justificativa: " " }))).status === 400)
    ok("gestor sem usuarios.gerenciar: 403", (await postIgnorar(req("POST", "/api/torre/integridade/ignorar", tGestor, { achadoId: alerta.id, justificativa: "x" }))).status === 403)
    const antes = Date.now()
    const rIg = await postIgnorar(req("POST", "/api/torre/integridade/ignorar", tAdmin, { achadoId: alerta.id, justificativa: "aguardando o cadastro" }))
    ok("ignorar 200", rIg.status === 200)
    const dep = await prisma.saudeAchado.findUniqueOrThrow({ where: { id: alerta.id } })
    ok("grava status, quem ignorou e até quando (+7 dias)", dep.status === "IGNORADO" && dep.ignoradoPorId === admin.id && Math.abs((dep.ignoradoAte as Date).getTime() - (antes + 7 * DIA)) < 60_000 && dep.justificativa === "aguardando o cadastro")
    ok("grava a auditoria", (await prisma.logAuditoria.count({ where: { acao: "SAUDE_ACHADO_IGNORADO", entidade: "SaudeAchado", entidadeId: alerta.id, usuarioId: admin.id } })) === 1)
    ok("some da lista viva e entra nos ignorados", !(await quadroDeIntegridade()).itens.some((i) => i.id === alerta.id) && (await quadroDeIntegridade()).itensIgnorados.some((i) => i.id === alerta.id))
    ok("achado inexistente: 422", (await postIgnorar(req("POST", "/api/torre/integridade/ignorar", tAdmin, { achadoId: 99999999, justificativa: "x" }))).status === 422)
    // depois de vencido o prazo, volta sozinho (o Saúde não o reabre — a Torre confere na leitura)
    await prisma.saudeAchado.update({ where: { id: alerta.id }, data: { ignoradoAte: new Date(Date.now() - 1000) } })
    ok("vencido o prazo, o achado VOLTA para a lista", (await quadroDeIntegridade()).itens.some((i) => i.id === alerta.id && i.voltouDeIgnorado))

    // ════════════ I2 — AUDITORIA ════════════
    secao("I2 — Auditoria: filtros, paginação, CSV")
    const o1 = await c.novaObrigacao({}); const o2 = await c.novaObrigacao({})
    const mkLog = (acao: string, tarefaId: number | null, usuarioId: number | null, quando: Date, motivo?: string, entidade = "Tarefa") =>
      prisma.logAuditoria.create({ data: { acao, entidade, entidadeId: tarefaId ?? 0, descricao: `${MARCA} ${acao} ${tarefaId}`, usuarioId, criadoEm: quando, ...(motivo ? { detalhes: { motivo } } : {}) } })
    const hoje = new Date()
    await mkLog("TAREFA_PRAZO_ALTERADO", o1.tarefaId, admin.id, new Date(hoje.getTime() - 2 * DIA), "cartório sem resposta")
    await mkLog("TAREFA_ATRIBUIDA", o1.tarefaId, outro.id, new Date(hoje.getTime() - 1 * DIA))
    await mkLog("TAREFA_PRIORIDADE_ALTERADA", o2.tarefaId, admin.id, new Date(hoje.getTime() - 10 * DIA))
    await mkLog("=EVIL()", o2.tarefaId, admin.id, new Date(hoje.getTime() - 3 * DIA), "=HYPERLINK(\"http://x\")")
    await mkLog("PROCESSO_EDITADO", o1.processoId, admin.id, new Date(hoje.getTime() - 4 * DIA), undefined, "Processo")
    await mkLog("ACAO_DE_OUTRA_ENTIDADE", 1, admin.id, hoje, undefined, "Documento")
    const dia = (d: Date) => d.toISOString().slice(0, 10)
    const todos = await consultarAuditoria({ natureza: "PROCESSO_TAREFA", processoId: o1.processoId }, 1, 50)
    ok("por processo: logs da tarefa E do próprio processo, nada de outro processo nem de outra entidade", todos.itens.some((l) => l.acao === "TAREFA_PRAZO_ALTERADO") && todos.itens.some((l) => l.acao === "PROCESSO_EDITADO") && !todos.itens.some((l) => l.acao === "TAREFA_PRIORIDADE_ALTERADA" && l.descricao.includes(String(o2.tarefaId))) && !todos.itens.some((l) => l.acao === "ACAO_DE_OUTRA_ENTIDADE"))
    ok("colunas: quando, autor, ação, alvo (com a tarefa e o processo), justificativa (a gravada)", (() => { const l = todos.itens.find((x) => x.acao === "TAREFA_PRAZO_ALTERADO")!; return l.autor === `${MARCA} Admin` && l.alvo.includes(`Tarefa #${o1.tarefaId}`) && l.justificativa === "cartório sem resposta" && !!l.quando })())
    ok("ação sem justificativa gravada → justificativa nula (não inventa)", todos.itens.find((x) => x.acao === "TAREFA_ATRIBUIDA")!.justificativa === null)
    const porAutor = await consultarAuditoria({ natureza: "PROCESSO_TAREFA", processoId: o1.processoId, autorId: outro.id })
    ok("filtro por autor", porAutor.itens.length >= 1 && porAutor.itens.every((l) => l.autor === `${MARCA} Outro`))
    const porPeriodo = await consultarAuditoria({ natureza: "PROCESSO_TAREFA", processoId: o2.processoId, de: dia(new Date(hoje.getTime() - 5 * DIA)), ate: dia(new Date(hoje.getTime() - 1 * DIA)) })
    ok("filtro por período (a de 10 dias atrás fica de fora)", porPeriodo.itens.every((l) => l.acao !== "TAREFA_PRIORIDADE_ALTERADA") && porPeriodo.itens.some((l) => l.acao === "=EVIL()"))
    const porAcao = await consultarAuditoria({ natureza: "PROCESSO_TAREFA", acao: "prazo_alterado", processoId: o1.processoId })
    ok("filtro por ação", porAcao.itens.length === 1)
    // A paginação precisa de linhas suficientes POR CONTA PRÓPRIA (antes dependia, sem declarar, dos logs que a
    // criação da obrigação "Atribuir tarefas" gerava — descontinuada em 30/09/2026).
    for (let i = 0; i < 4; i++) await mkLog("TAREFA_ATRIBUIDA", o2.tarefaId, admin.id, hoje)
    const p1 = await consultarAuditoria({ natureza: "PROCESSO_TAREFA" }, 1, 2), p2 = await consultarAuditoria({ natureza: "PROCESSO_TAREFA" }, 2, 2)
    ok("paginação no servidor: 2 por página, total real, páginas distintas", p1.itens.length === 2 && p2.itens.length === 2 && p1.total === p2.total && p1.total >= 6 && p1.itens[0].id !== p2.itens[0].id)
    ok("nunca traz outra entidade", (await consultarAuditoria({ natureza: "PROCESSO_TAREFA" }, 1, 200)).itens.every((l) => l.acao !== "ACAO_DE_OUTRA_ENTIDADE"))
    ok("porPagina é limitado a 200", (await consultarAuditoria({ natureza: "PROCESSO_TAREFA" }, 1, 99999)).porPagina === 200)
    ok("gestor (não admin): 403", (await getAuditoria(req("GET", "/api/torre/auditoria", tGestor))).status === 403)
    const rAud = await (await getAuditoria(req("GET", `/api/torre/auditoria?natureza=PROCESSO_TAREFA&processoId=${o1.processoId}&autorId=${outro.id}`, tAdmin))).json()
    ok("rota com filtros", rAud.total === porAutor.total)

    const csvRes = await getCsv(req("GET", `/api/torre/auditoria/csv?natureza=PROCESSO_TAREFA&processoId=${o2.processoId}`, tAdmin))
    const bytes = new Uint8Array(await csvRes.clone().arrayBuffer())
    const csv = await csvRes.text()   // o decodificador remove o BOM do texto; ele é conferido nos bytes
    const filtrado = await consultarAuditoria({ natureza: "PROCESSO_TAREFA", processoId: o2.processoId }, 1, 200)
    ok("CSV: 200, text/csv, anexo", csvRes.status === 200 && /text\/csv/.test(csvRes.headers.get("content-type") ?? "") && /attachment; filename="auditoria-torre-\d{4}-\d{2}-\d{2}\.csv"/.test(csvRes.headers.get("content-disposition") ?? ""))
    ok("CSV: BOM (nos bytes), cabeçalho e UMA linha por registro filtrado (o mesmo recorte da tela)", bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF && csv.split("\r\n").filter(Boolean).length === filtrado.total + 1 && csv.startsWith('"Quando";"Autor";"Ação";"Alvo";"Justificativa";"Descrição"'))
    ok("CSV: fórmula injetada é neutralizada (começa com apóstrofo)", csv.includes(`"'=EVIL()"`) && csv.includes(`"'=HYPERLINK(`) && !/;"=EVIL/.test(csv))
    ok("CSV: gestor 403 e a exportação de admin fica auditada", (await getCsv(req("GET", "/api/torre/auditoria/csv", tGestor))).status === 403 && (await prisma.logAuditoria.count({ where: { acao: "AUDITORIA_EXPORTADA", usuarioId: admin.id } })) === 1)
    const semFiltro = await csvDaAuditoria({ natureza: "PROCESSO_TAREFA", processoId: o1.processoId })
    ok("CSV informa quando não trunca", semFiltro.truncado === false && semFiltro.linhas === semFiltro.total)

    // ════════════ I3 — FOCO ════════════
    secao("I3 — Foco da família")
    const familia = await prisma.familia.create({ data: { nome: `${MARCA} Família` } })
    const ontem = new Date(Date.now() - 2 * DIA)
    const f1 = await c.novaObrigacao({ aguardando: true, responsavelId: admin.id, dataPrazo: ontem })
    const f2 = await c.novaObrigacao({ aguardando: true, dataPrazo: new Date(Date.now() + 5 * DIA) })
    const f3 = await c.novaObrigacao({ responsavelId: outro.id, dataPrazo: new Date(Date.now() + 9 * DIA) })
    for (const f of [f1, f2, f3]) void f
    // um processo só, com as 3 tarefas: move f2 e f3 para o processo de f1 (o Foco é por processo/família)
    await prisma.processo.update({ where: { id: f1.processoId }, data: { familiaId: familia.id, codigo: `${MARCA}-651` } })
    await prisma.tarefa.updateMany({ where: { id: { in: [f2.tarefaId, f3.tarefaId] } }, data: { processoId: f1.processoId } })
    const foco = await focoDaFamilia(f1.processoId)
    ok("cabeçalho: família · país · código, fase e certidões recebidas", foco!.familiaNome === `${MARCA} Família` && foco!.codigo === `${MARCA}-651` && foco!.familiaId === familia.id && foco!.faseAtual.key === c.PHASE_KEY && typeof foco!.faseAtual.label === "string")
    const prog = await progressoRealDoProcesso(f1.processoId)
    ok("'X de Y certidões recebidas' = o progresso real do Bloco E9", foco!.certidoes.recebidas === prog.completed && foco!.certidoes.requeridas === prog.required)
    const linhasAba = (await listarTarefasDaTorre({})).linhas.filter((l) => l.processoId === f1.processoId)
    const nAba = { abertas: linhasAba.length, vencidas: linhasAba.filter((l) => l.atrasada).length, comCartorio: linhasAba.filter((l) => l.estadoOperacao === "AGUARDANDO").length, semResponsavel: linhasAba.filter((l) => l.responsavelId == null).length }
    ok("os 4 números BATEM com a aba Tarefas (mesmos filtros: Vencidas / Com o cartório / Sem responsável)", JSON.stringify(foco!.numeros) === JSON.stringify(nAba), JSON.stringify(foco!.numeros))
    ok("e os valores esperados dos dados: 1 vencida, 2 com o cartório", foco!.numeros.vencidas === 1 && foco!.numeros.comCartorio === 2 && foco!.numeros.semResponsavel >= 1)
    ok("numerosDoFoco é a definição única", JSON.stringify(numerosDoFoco(linhasAba)) === JSON.stringify(nAba))
    ok("a tabela traz as linhas da Operação (cartório, bola, prazo, responsável)", foco!.tarefas.length === linhasAba.length && foco!.tarefas.every((t) => "terceiroNome" in t && "responsavelNome" in t && "rotuloDoPrazo" in t))
    await registrarLigacao(f1.tarefaId, admin.id, `${MARCA} ligou`, "EM_BUSCA")
    const foco2 = await focoDaFamilia(f1.processoId)
    // A linha do tempo do Foco É o Histórico do processo (um registro por fato real, mesma fonte da aba Histórico):
    // o Foco não monta mais uma lista própria. O contato REAL (ligação) aparece como fato redigido, mais recente primeiro.
    const hist = await historicoDoProcesso(f1.processoId)
    ok("o Foco não carrega mais linha do tempo própria (ela é o Histórico do processo)", !("linhaDoTempo" in foco2!))
    ok("histórico REAL: a ligação ao cartório do banco vira fato redigido (em busca), mais recente primeiro", !!hist && hist.fatos.some((x) => x.subtipo === "cobranca" && /em busca/.test(x.frase)) && hist.fatos.every((x, i, a) => i === 0 || a[i - 1].quando >= x.quando))
    ok("nada inventado: cada fato tem id de origem (log/contato/…)", !!hist && hist.fatos.every((x) => /^(log|wf|fase|nec|contato|coment|sub|passo|solic|obs|hist):\d+$/.test(x.id) || x.id.startsWith("g:")))
    const rHist = await getFocoHistorico(req("GET", `/api/torre/foco/${f1.processoId}/historico`, tGestor), ctx({ processoId: String(f1.processoId) }))
    ok("rota do histórico dentro do Foco: gestor da Torre lê (200) e vem a MESMA lista", rHist.status === 200 && (await rHist.json()).fatos.length === hist!.fatos.length)
    ok("rota: gestor da Torre lê o Foco", (await getFoco(req("GET", `/api/torre/foco/${f1.processoId}`, tGestor), ctx({ processoId: String(f1.processoId) }))).status === 200)
    ok("rota: processo inexistente 404, id inválido 400, sem token 401",
      (await getFoco(req("GET", "/api/torre/foco/99999999", tAdmin), ctx({ processoId: "99999999" }))).status === 404
      && (await getFoco(req("GET", "/api/torre/foco/x", tAdmin), ctx({ processoId: "x" }))).status === 400
      && (await getFoco(req("GET", "/api/torre/foco/1", null), ctx({ processoId: "1" }))).status === 401)
    await prisma.familia.delete({ where: { id: familia.id } }).catch(() => {})
  } finally {
    await prisma.saudeAchado.deleteMany({ where: { chave: { startsWith: MARCA } } })
    await prisma.logAuditoria.deleteMany({ where: { descricao: { contains: MARCA } } })
    await c.limpar()
    await prisma.familia.deleteMany({ where: { nome: { startsWith: MARCA } } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
