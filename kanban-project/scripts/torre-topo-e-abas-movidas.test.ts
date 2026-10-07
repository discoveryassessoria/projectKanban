// scripts/torre-topo-e-abas-movidas.test.ts
// ============================================================================
// TORRE — SEÇÕES 1 e 2 (01/10/2026): o que NÃO é gestão de processo saiu da Torre, e o topo novo (frase + SITUAÇÃO + AGENDA).
//
//   npx tsx scripts/torre-topo-e-abas-movidas.test.ts   (banco de teste)
//
// PROVA:
//   1.1/1.5/1.6  abas antigas → destino no Gerenciamento; a Torre fica com 7 abas (Visão geral na frente); Regras/Integridade/Auditoria são sub-abas da Saúde;
//   1.2          Auditoria: mapa único SISTEMA × PROCESSO/TAREFA, padrão Sistema, filtros e CSV na mesma consulta;
//   1.3          o "Precisa de você" não produz mais achado de cadastro (PAREDE_A_FRENTE);
//   1.1          as portas de Regras/Integridade valem para quem tem usuarios.gerenciar (sem exigir ser gestor da Torre);
//   2.x          frase, partição exata (equipe + cartório + ninguém = abertas), AGENDA com data FIXA no fuso de São Paulo,
//                e número do cartão = tamanho da lista que o clique filtra (mesma função nos dois lados).
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-topo-e-abas-movidas.test.ts")

import { readFileSync, existsSync } from "node:fs"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import {
  KPIS, KPI_POR_CHAVE, CARTOES_DA_SITUACAO, CARTOES_DA_AGENDA, CAMPO_DA_FOTO, PREDICADO_DO_KPI, linhasDoKpi, numeroDoKpi, situacaoDaTarefa, diasAtePrazo,
  type LinhaParaKpi,
} from "../lib/operacional/torre-kpis"
import { topoDaTorre, fraseDoDia, textoDaFrase, distribuicaoPorPais, type LinhaParaTopo } from "../lib/operacional/torre-topo"
import { destinoDaAbaAntigaDaTorre, urlDaSaudeDoSistema, SUB_ABAS_DA_SAUDE } from "../lib/operacional/navegacao"
import { ABAS_DA_TORRE } from "../lib/operacional/torre-abas"
import { ACOES_DE_SISTEMA, NATUREZA_DA_ACAO, consultarAuditoria, csvDaAuditoria, filtroDaQuery } from "../lib/operacional/torre-auditoria"
import { itensPrecisaDeVoce } from "../lib/operacional/precisa-de-voce"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { GET as getRegras } from "../src/app/api/torre/regras/route"
import { POST as postSimular } from "../src/app/api/torre/regras/[chave]/simular/route"
import { GET as getIntegridade } from "../src/app/api/torre/integridade/route"
import { GET as getTarefasTorre } from "../src/app/api/torre/tarefas/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORRETOPO"
const req = (method: string, url: string, token: string | null) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" } })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })
const ler = (p: string) => readFileSync(p, "utf8")

// Uma linha sintética (só os campos que o topo lê).
let seq = 0
const L = (o: Partial<LinhaParaTopo> = {}): LinhaParaTopo => ({
  processoId: 1, dataPrazo: null, responsavelId: 7, atrasada: false, diasParaPrazo: null, estadoOperacao: "FILA", acompanhamentoVencido: false, escalada: false,
  faseMacroKey: "emissao_documental", aIniciar: false, statusTarefa: "NAO_INICIADA", familiaNome: "Família A", processoNome: null, ...o, _id: ++seq,
} as LinhaParaTopo)

async function main() {
  // ═══════════ SEÇÃO 2 — puro, com data FIXA ═══════════
  secao("2.3 — AGENDA com data FIXA no fuso de São Paulo (dia operacional, não UTC)")
  const AGORA = new Date("2026-09-30T15:00:00Z")           // 30/09/2026 12:00 em São Paulo
  const prazo = (iso: string) => ({ dataPrazo: iso })
  const linhas: LinhaParaTopo[] = [
    L(prazo("2026-09-29T20:00:00Z")),   // ontem → atrasada
    L(prazo("2026-09-30T02:00:00Z")),   // 29/09 23:00 SP (ainda é dia 29 em SP, embora seja dia 30 em UTC) → ATRASADA
    L(prazo("2026-10-01T02:30:00Z")),   // 30/09 23:30 SP → vence HOJE (em UTC já seria dia 1)
    L(prazo("2026-09-30T23:00:00Z")),   // hoje 20:00 SP → hoje
    L(prazo("2026-10-01T12:00:00Z")),   // amanhã
    L(prazo("2026-10-02T12:00:00Z")),   // +2 → próximos 7 dias
    L(prazo("2026-10-07T12:00:00Z")),   // +7 → próximos 7 dias (limite inclusive)
    L(prazo("2026-10-08T12:00:00Z")),   // +8 → fora de tudo
    L({ dataPrazo: null }),             // sem prazo
    L({ dataPrazo: null, estadoOperacao: "AGUARDANDO", responsavelId: 7 }), // sem prazo, aguardando terceiros
  ]
  const n = (k: Parameters<typeof numeroDoKpi>[0]) => numeroDoKpi(k, linhas, AGORA)
  ok("dias até o prazo: hoje 0, amanhã 1, ontem −1, sem prazo null", diasAtePrazo(linhas[2], AGORA) === 0 && diasAtePrazo(linhas[4], AGORA) === 1 && diasAtePrazo(linhas[0], AGORA) === -1 && diasAtePrazo(linhas[8], AGORA) === null)
  ok("Atrasadas = 2 (inclui 29/09 23:00 SP, que em UTC já é dia 30)", n("venc") === 2, String(n("venc")))
  ok("Vence hoje = 2 (inclui 30/09 23:30 SP, que em UTC já é dia 1)", n("hoje") === 2, String(n("hoje")))
  ok("Amanhã = 1", n("amanha") === 1)
  ok("Próximos 7 dias = 2 (+2 e +7; SEM hoje/amanhã; +8 fora)", n("prox7") === 2)
  ok("Sem prazo = 2", n("sprazo") === 2)
  ok("o prazo NÃO pausa por terceiro: tarefa aguardando terceiros e prazo vencido continua Atrasada", numeroDoKpi("venc", [L({ ...prazo("2026-09-20T12:00:00Z"), estadoOperacao: "AGUARDANDO" })], AGORA) === 1)
  ok("hoje, amanhã, próximos 7 e atrasadas nunca se repetem (prazos disjuntos)", CARTOES_DA_AGENDA.filter((k) => ["venc", "hoje", "amanha", "prox7"].includes(k)).every((k, i, a) => a.slice(i + 1).every((j) => !linhas.some((l) => PREDICADO_DO_KPI[k]!(l, AGORA) && PREDICADO_DO_KPI[j]!(l, AGORA)))))
  ok("os mesmos prazos com outro 'agora' dão outra agenda (a data é injetada, não o relógio)", numeroDoKpi("hoje", linhas, new Date("2026-10-01T15:00:00Z")) === 1 && numeroDoKpi("venc", linhas, new Date("2026-10-01T15:00:00Z")) === 4)

  secao("2.2 — SITUAÇÃO: partição exata e precedência escrita")
  const part: LinhaParaTopo[] = [
    L({ responsavelId: null }),                                       // ninguém
    L({ responsavelId: null, estadoOperacao: "AGUARDANDO" }),         // sem responsável E aguardando → PRECEDÊNCIA: ninguém
    L({ responsavelId: 7, estadoOperacao: "AGUARDANDO" }),            // cartório
    L({ responsavelId: 7, estadoOperacao: "FILA" }),                  // equipe
    L({ responsavelId: 8, statusTarefa: "EM_ANDAMENTO" }),            // equipe
  ]
  ok("sem responsável E aguardando → 'Sem responsável' (precedência: sem responsável > aguardando terceiros > equipe)", situacaoDaTarefa(part[1]) === "ninguem")
  ok("Sem responsável=2 · Aguardando terceiros=1 · Com a equipe=2", numeroDoKpi("ninguem", part, AGORA) === 2 && numeroDoKpi("cartorio", part, AGORA) === 1 && numeroDoKpi("equipe", part, AGORA) === 2)
  ok("os TRÊS somam 'Tarefas abertas' (partição exata)", numeroDoKpi("ninguem", part, AGORA) + numeroDoKpi("cartorio", part, AGORA) + numeroDoKpi("equipe", part, AGORA) === numeroDoKpi("abertas", part, AGORA))
  ok("cada tarefa cai em UM e só um dos três", part.every((l) => ["ninguem", "cartorio", "equipe"].filter((k) => PREDICADO_DO_KPI[k as "ninguem"]!(l, AGORA)).length === 1))
  ok("'Sem responsável' (cartão) é a MESMA conta do antigo `semdono` (foto E10 comparável)", part.every((l) => PREDICADO_DO_KPI.ninguem!(l, AGORA) === PREDICADO_DO_KPI.semdono!(l, AGORA)))

  secao("2.5/2.x — REGRA escrita de cada indicador e tendência só onde a definição é a da foto")
  ok("todo cartão do topo tem rótulo e REGRA escrita", [...CARTOES_DA_SITUACAO, ...CARTOES_DA_AGENDA, "risco" as const].every((k) => KPI_POR_CHAVE[k].rotulo.length > 0 && KPI_POR_CHAVE[k].regra.length > 20))
  ok("toda chave de KPI tem predicado (exceto risco/back, que são por processo/agregado)", KPIS.filter((k) => k.chave !== "risco" && k.chave !== "back").every((k) => typeof PREDICADO_DO_KPI[k.chave] === "function"))
  ok("tendência: venc, ninguem, cob e risco (definição igual à da foto antiga) + abertas, equipe e cartorio (colunas novas da M4, MESMA definição do cartão); a agenda nova (hoje/prox7…) NÃO", CAMPO_DA_FOTO.venc === "vencidas" && CAMPO_DA_FOTO.ninguem === "semDono" && CAMPO_DA_FOTO.cob === "cobrancasPendentes" && CAMPO_DA_FOTO.risco === "emRisco" && CAMPO_DA_FOTO.cartorio === "comCartorio" && CAMPO_DA_FOTO.equipe === "comEquipe" && CAMPO_DA_FOTO.abertas === "tarefasAbertas" && !CAMPO_DA_FOTO.hoje && !CAMPO_DA_FOTO.prox7)
  const kp = ler("src/components/torre/TorreKpis.tsx")
  ok("nenhum cartão escreve 'sem histórico' nem 'tendência só no total'", !/sem histórico|tendência só no total/i.test(kp))
  ok("cada cartão clica e filtra com o mesmo predicado (Torre.tsx usa linhasDoKpi; a aba Tarefas usa linhasDoKpi)", /linhasDoKpi\(kpi, linhasPais, agora\)/.test(ler("src/components/torre/Torre.tsx")) && /linhasDoKpi\(kpi, linhas, agora\)/.test(ler("src/components/torre/TorreTarefas.tsx")) && /numeroDoKpi\(k, linhas, agora\)/.test(kp))
  ok("as visões 'Vencidas', 'Sem responsável' e 'Aguardando terceiros' da aba Tarefas usam os predicados dos cartões", /PREDICADO_DO_KPI\.venc!/.test(ler("lib/operacional/torre-tarefas-tela.ts")) && /PREDICADO_DO_KPI\.ninguem!/.test(ler("lib/operacional/torre-tarefas-tela.ts")) && /PREDICADO_DO_KPI\.cartorio!/.test(ler("lib/operacional/torre-tarefas-tela.ts")) && /predicadoDaVisao\(visao/.test(ler("src/components/torre/TorreTarefas.tsx")))

  secao("2.1 — a FRASE do dia (Torre nova: processos ativos, no ritmo, decisões por tipo, gargalo)")
  const dec = (tipo: string, n: number) => Array.from({ length: n }, () => ({ tipo }))
  const f1 = textoDaFrase(fraseDoDia({ processos: 2, noRitmo: 1, decisoes: [...dec("SEM_DONO", 2), ...dec("CARGA", 1)], gargalo: null }))
  ok("frase com decisões: 'Hoje: 2 processos ativos, 1 andando no ritmo. 3 decisões precisam de você: 2 sem dono, 1 de carga da equipe.'", f1 === "Hoje: 2 processos ativos, 1 andando no ritmo. 3 decisões precisam de você: 2 sem dono, 1 de carga da equipe.", f1)
  ok("sem decisão e sem gargalo", textoDaFrase(fraseDoDia({ processos: 0, noRitmo: 0, decisoes: [], gargalo: null })) === "Hoje: 0 processos ativos, 0 andando no ritmo. Nenhuma decisão precisa de você.")
  const t = topoDaTorre(part, [{ risco: "critico", pais: "Itália", faseAtual: { label: "Genealogia" } }, { risco: "ok", pais: "Espanha", faseAtual: { label: "Emissão" } }], AGORA)
  ok("Processos ativos: total, distribuição por PAÍS e 'N em risco' (crítico)", t.processosAtivos.total === 2 && t.processosAtivos.distribuicao === "Espanha 1 · Itália 1" && t.processosAtivos.emRisco === 1, t.processosAtivos.distribuicao)
  ok("distribuição sem país", distribuicaoPorPais([{ pais: null }]) === "Sem país 1")

  secao("2.5 — backlog vai para a aba Processos; 'Escaladas pra mim' e Backlog saem do topo")
  // Torre nova: o protótipo mostra a linha da semana na Visão geral (TorreFunil), não na aba Processos (que agora é por fase).
  ok("a linha 'Semana: …' mora na Visão geral (funil) e a aba Processos, por fase, não a repete", /Semana:/.test(ler("src/components/torre/TorreFunil.tsx")) && !/Semana:/.test(ler("src/components/torre/TorreProcessos.tsx")))
  ok("o topo não tem mais 'Escaladas pra mim' nem 'Backlog'", !CARTOES_DA_SITUACAO.concat(CARTOES_DA_AGENDA).some((k) => k === "esc" || k === "back"))

  // ═══════════ SEÇÃO 1 — abas movidas ═══════════
  secao("1.5/1.6 — a Torre tem 7 abas (Visão geral na frente); as antigas redirecionam para o Gerenciamento")
  const torre = ler("src/components/torre/Torre.tsx")
  const abas = /export const ABAS: Array<\[Aba, string\]> = \[([\s\S]*?)\n\]/.exec(torre)?.[1].match(/\["(\w+)", "([^"]+)"\]/g) ?? []
  const abasDoCasco = /export const ABAS: Array<\[Aba, string\]> = ABAS_DA_TORRE/.test(torre)
  ok("o casco usa a lista única de abas (lib/operacional/torre-abas.ts)", abasDoCasco)
  ok("exatamente 8 abas, na ordem: Visão geral · Precisa de você · Radar · Processos · Tarefas · Minha operação · Equipe · Terceiros", ABAS_DA_TORRE.length === 8 && ABAS_DA_TORRE.map(([, r]) => r).join(" · ") === "Visão geral · Precisa de você · Radar · Processos · Tarefas · Minha operação · Equipe · Terceiros", ABAS_DA_TORRE.map(([, r]) => r).join(","))
  ok("a Torre não importa mais Regras/Integridade/Auditoria", !/TorreRegras|TorreIntegridade|TorreAuditoria|SaudeRegras/.test(torre) && !existsSync("src/components/torre/TorreRegras.tsx") && !existsSync("src/components/torre/TorreIntegridade.tsx") && !existsSync("src/components/torre/TorreAuditoria.tsx"))
  ok("a Torre redireciona a aba antiga com router.replace", /destinoDaAbaAntigaDaTorre\(params\.get\("aba"\)\)/.test(torre) && /router\.replace\(destinoAntigo\)/.test(torre))
  ok("?aba=regras → Gerenciamento › Saúde › Regras", destinoDaAbaAntigaDaTorre("regras") === "/administrator?screen=syshealth&sub=regras")
  ok("?aba=integridade → …&sub=integridade", destinoDaAbaAntigaDaTorre("integridade") === "/administrator?screen=syshealth&sub=integridade")
  ok("?aba=auditoria → …&sub=auditoria", destinoDaAbaAntigaDaTorre("auditoria") === "/administrator?screen=syshealth&sub=auditoria")
  ok("as abas que continuam da Torre NÃO redirecionam", ["visao", "precisa", "radar", "tarefas", "equipe", "processos", "terceiros", null, undefined, ""].every((x) => destinoDaAbaAntigaDaTorre(x) === null))
  ok("a Saúde tem as cinco sub-abas (a quinta, 'metas', é nova) e a URL 'saude' é a tela de sempre", SUB_ABAS_DA_SAUDE.join() === "saude,regras,integridade,auditoria,metas" && urlDaSaudeDoSistema() === "/administrator?screen=syshealth")
  const saude = ler("src/components/gerenciamentoComponents/SaudeSistemaTab.tsx")
  ok("Saúde do sistema monta Regras, Integridade e Auditoria (Auditoria só admin) com o deep-link ?sub=", /<SaudeRegras/.test(saude) && /<SaudeIntegridade/.test(saude) && /isAdmin \? <SaudeAuditoria/.test(saude) && /get\("sub"\)/.test(saude))
  ok("o sino INTEGRIDADE aponta para o Gerenciamento › Saúde › Integridade", /urlDaSaudeDoSistema\('integridade'\)/.test(ler("lib/operacional/avisos-sino.ts")))

  secao("1.3 — 'Precisa de você' sem achado de cadastro")
  ok("o motor não produz mais itens PAREDE_A_FRENTE nem lê os achados da parede", !/tipo: 'PAREDE_A_FRENTE'/.test(ler("lib/operacional/precisa-de-voce.ts")) && !/achadosVigentesDaParede/.test(ler("lib/operacional/precisa-de-voce.ts")))

  secao("1.2 — Auditoria: mapa único SISTEMA × PROCESSO/TAREFA (puro)")
  ok("exclusão de processo, regra ativada/desativada/executada/simulada, visão compartilhada, exportação, backfill, ignorar achado = SISTEMA", ["processo_excluido_definitivo", "REGRA_TORRE_ATIVADA", "REGRA_TORRE_DESATIVADA", "REGRA_TORRE_EXECUTADA", "REGRA_TORRE_SIMULADA", "VISAO_COMPARTILHADA", "AUDITORIA_EXPORTADA", "BACKFILL_PASSOS_PUBLICADOS", "SAUDE_ACHADO_IGNORADO"].every((x) => NATUREZA_DA_ACAO(x, "Processo") === "SISTEMA"))
  ok("fatos de tarefa/processo = PROCESSO_TAREFA; entidade de fora sem ação de sistema = nenhum", NATUREZA_DA_ACAO("TAREFA_ATRIBUIDA", "Tarefa") === "PROCESSO_TAREFA" && NATUREZA_DA_ACAO("PROCESSO_EDITADO", "Processo") === "PROCESSO_TAREFA" && NATUREZA_DA_ACAO("LOGIN", "ACESSO") === null)
  const emitidas = new Set<string>()
  for (const f of ["lib/operacional/regras-torre.ts", "src/app/api/torre/visoes/route.ts", "src/app/api/torre/auditoria/csv/route.ts", "src/app/api/torre/regras/[chave]/simular/route.ts"]) {
    for (const m of ler(f).matchAll(/acao: ([^,]+),/g)) for (const x of m[1].matchAll(/'([A-Za-z_]+)'/g)) emitidas.add(x[1])
  }
  ok("TODA ação de auditoria gravada pelo código da Torre está classificada como SISTEMA", emitidas.size >= 8 && [...emitidas].every((x) => ACOES_DE_SISTEMA.includes(x)), [...emitidas].join(","))
  ok("o filtro da query assume SISTEMA quando nada é dito", filtroDaQuery(new URLSearchParams("")).natureza === "SISTEMA" && filtroDaQuery(new URLSearchParams("natureza=processo_tarefa")).natureza === "PROCESSO_TAREFA" && filtroDaQuery(new URLSearchParams("natureza=x")).natureza === "SISTEMA")

  // ═══════════ com banco ═══════════
  const c = await montarCenario(MARCA)
  try {
    const mk = (nome: string, tipo: string, perms?: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const admin = await mk("Admin", "admin")
    const gerencia = await mk("Gerencia", "assistente", { "tarefas.ver": true, "usuarios.gerenciar": true })      // gerencia usuários, NÃO é gestor da Torre
    const semNada = await mk("Sem", "assistente", { "tarefas.ver": true })
    const tAdmin = await tokenDe(admin), tGer = await tokenDe(gerencia), tSem = await tokenDe(semNada)

    secao("1.1 — Regras e Integridade valem para quem tem usuarios.gerenciar (a régua da Saúde), sem exigir ser gestor da Torre")
    ok("gerência de usuários (não gestora da Torre) lê as Regras", (await getRegras(req("GET", "/api/torre/regras", tGer))).status === 200)
    ok("…e a Integridade", (await getIntegridade(req("GET", "/api/torre/integridade", tGer))).status === 200)
    ok("quem não tem usuarios.gerenciar: 403 nas duas", (await getRegras(req("GET", "/api/torre/regras", tSem))).status === 403 && (await getIntegridade(req("GET", "/api/torre/integridade", tSem))).status === 403)
    ok("a Torre (tarefas) continua só para gestor: a gerência de usuários leva 403 lá", (await getTarefasTorre(req("GET", "/api/torre/tarefas", tGer))).status === 403)

    secao("1.2 — simular é auditado; Auditoria padrão = Sistema; filtros e CSV na mesma consulta")
    const antes = await prisma.logAuditoria.count({ where: { acao: "REGRA_TORRE_SIMULADA" } })
    const rs = await postSimular(req("POST", "/api/torre/regras/r3/simular", tAdmin), { params: Promise.resolve({ chave: "r3" }) })
    ok("simular grava a auditoria (e não altera tarefa)", rs.status === 200 && (await prisma.logAuditoria.count({ where: { acao: "REGRA_TORRE_SIMULADA" } })) === antes + 1)
    const o = await c.novaObrigacao({ responsavelId: admin.id })
    const mkLog = (acao: string, entidade: string, entidadeId: number | null) => prisma.logAuditoria.create({ data: { acao, entidade, entidadeId, usuarioId: admin.id, descricao: `${MARCA} ${acao}` } })
    await mkLog("processo_excluido_definitivo", "Processo", o.processoId)
    await mkLog("REGRA_TORRE_ATIVADA", "RegraTorre", null)
    await mkLog("TAREFA_ATRIBUIDA", "Tarefa", o.tarefaId)
    const so = async (natureza: "SISTEMA" | "PROCESSO_TAREFA" | "TODOS") => (await consultarAuditoria({ natureza, de: null }, 1, 200)).itens.filter((l) => l.descricao.startsWith(MARCA)).map((l) => l.acao).sort().join()
    ok("Sistema: exclusão de processo e regra; NUNCA a atribuição de tarefa", await so("SISTEMA") === "REGRA_TORRE_ATIVADA,processo_excluido_definitivo", await so("SISTEMA"))
    ok("Processo e tarefa: só a atribuição (a exclusão de processo, que é de sistema, não vaza para cá)", await so("PROCESSO_TAREFA") === "TAREFA_ATRIBUIDA", await so("PROCESSO_TAREFA"))
    ok("Todos: os dois", await so("TODOS") === "REGRA_TORRE_ATIVADA,TAREFA_ATRIBUIDA,processo_excluido_definitivo", await so("TODOS"))
    ok("sem filtro de natureza na chamada = Sistema", (await consultarAuditoria({}, 1, 200)).itens.every((l) => ACOES_DE_SISTEMA.includes(l.acao)))
    const csv = await csvDaAuditoria({ natureza: "SISTEMA" })
    const tela = await consultarAuditoria({ natureza: "SISTEMA" }, 1, 200)
    ok("o CSV usa o mesmo recorte da tela", csv.total === tela.total && csv.csv.includes("processo_excluido_definitivo"))
    ok("a exclusão de um processo já removido mostra o alvo sem inventar o nome", tela.itens.some((l) => l.acao === "processo_excluido_definitivo" && /^Processo #\d+/.test(l.alvo)))

    secao("2 — número do cartão = tamanho da lista que o clique filtra, sobre as linhas REAIS da aba Tarefas")
    const dia = 86_400_000
    await c.novaObrigacao({ dataPrazo: new Date(Date.now() - 3 * dia) })
    await c.novaObrigacao({ responsavelId: admin.id, dataPrazo: new Date(Date.now() + 1 * dia) })
    await c.novaObrigacao({ responsavelId: admin.id, aguardando: true, dataPrazo: new Date(Date.now() + 5 * dia) })
    const agora = new Date()
    const reais = (await listarTarefasDaTorre({}, agora)).linhas
    ok("há linhas reais para provar", reais.length >= 4, String(reais.length))
    const topo = topoDaTorre(reais, [], agora)
    ok("cada cartão = linhasDoKpi(...).length (a lista que o clique filtra)", [...topo.situacao, ...topo.agenda].every((k) => k.valor === linhasDoKpi(k.chave, reais, agora).length))
    ok("a partição fecha sobre as linhas reais: equipe + cartório + ninguém = tarefas abertas = tamanho da aba Tarefas", (() => { const v = (k: string) => topo.situacao.find((x) => x.chave === k)!.valor; return v("equipe") + v("cartorio") + v("ninguem") === v("abertas") && v("abertas") === reais.length })())
    ok("a conta por dia operacional bate com a da projeção (atrasada e diasParaPrazo) nas linhas reais", reais.every((l: LinhaParaKpi) => (diasAtePrazo(l, agora) != null && diasAtePrazo(l, agora)! < 0) === l.atrasada && diasAtePrazo(l, agora) === l.diasParaPrazo))
    const itens = await itensPrecisaDeVoce({ agora })
    ok("'Precisa de você' real: nenhum item de cadastro", itens.every((i) => i.tipo !== "PAREDE_A_FRENTE"))
  } finally {
    await prisma.logAuditoria.deleteMany({ where: { OR: [{ descricao: { startsWith: MARCA } }, { acao: "REGRA_TORRE_SIMULADA" }] } })
    await c.limpar()
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA.toLowerCase() } } }).catch(() => {})
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
