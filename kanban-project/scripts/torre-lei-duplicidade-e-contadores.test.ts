// scripts/torre-lei-duplicidade-e-contadores.test.ts
// ============================================================================
// A LEI DA TORRE (consolidação, 06/10/2026) — "nada responde duas vezes; eu olho a tela e vejo o que está acontecendo":
//   L1 cada informação em UM lugar · L2 cada aba responde UMA pergunta · L3 todo número é a própria lista (a MESMA consulta) · L4 só a aba Tarefas
//   atribui · L5 estado de fase tem uma fonte só · L6 bloco/aba novo diz que pergunta responde e que bloco substitui.
// Parte 1 (estática): nenhum bloco/contador é renderizado em duas abas; 5 abas, uma pergunta cada; atribuição só nos arquivos permitidos.
// Parte 2 (banco de TESTE, dados semeados — nunca produção): todo número exibido = tamanho da lista que ele abre (alarmes de Hoje, Terceiros,
//   canceladas da página do processo × aba Tarefas, cartões do processo × tabela).
//   node scripts/ci/gate-build.mjs --suite todas --so torre-lei-duplicidade-e-contadores
// ============================================================================
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { ABAS_DA_TORRE, PERGUNTA_DA_ABA } from "../lib/operacional/torre-abas"
import { ALARMES_DE_HOJE, linhasDoAlarme, numeroDoAlarme } from "../lib/operacional/torre-hoje"
import { numeroDoKpi, linhasDoKpi } from "../lib/operacional/torre-kpis"
import { contagemDaVisao, predicadoDaVisao } from "../lib/operacional/torre-tarefas-tela"
import { aplicarFiltros, filtrosVazios } from "../lib/operacional/torre-filtros"
import { passosDaFase, somaExibidaDosPassos } from "../lib/operacional/torre-fase"
import { tarefasDaFaseDoProcesso } from "../lib/operacional/torre-processos"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const ler = (p: string) => readFileSync(p, "utf8")
const DIR = "src/components/torre"
const arquivosTorre = readdirSync(DIR).filter((f) => f.endsWith(".tsx")).map((f) => ({ f, t: ler(join(DIR, f)) }))
const contem = (texto: string) => arquivosTorre.filter((a) => a.t.includes(texto)).map((a) => a.f)

async function main() {
  secao("L2 — cinco abas, uma pergunta cada, escrita no cabeçalho")
  ok("5 abas na ordem Hoje · Tarefas · Famílias · Equipe · Terceiros", ABAS_DA_TORRE.map(([, r]) => r).join(" · ") === "Hoje · Tarefas · Famílias · Equipe · Terceiros")
  ok("as 5 perguntas são distintas", new Set(Object.values(PERGUNTA_DA_ABA)).size === 5)
  const casco = ler(`${DIR}/Torre.tsx`)
  for (const c of ["TorreHoje", "TorreTarefas", "TorreFamilias", "TorreEquipe", "TorreTerceiros"]) ok(`o casco monta <${c}> UMA vez (nenhum bloco em duas abas)`, (casco.match(new RegExp(`<${c}\\b`, "g")) ?? []).length === 1)
  for (const [aba, arq] of [["hoje", "TorreHoje.tsx"], ["tarefas", "TorreTarefas.tsx"], ["familias", "TorreFamilias.tsx"], ["equipe", "TorreEquipe.tsx"], ["terceiros", "TorreTerceiros.tsx"]]) {
    const t = ler(join(DIR, arq))
    ok(`${arq} escreve a pergunta da aba (L2)`, new RegExp(`PerguntaDaAba aba="${aba}"|PERGUNTA_DA_ABA\\.${aba}`).test(t))
  }
  ok("saíram da Torre: Visão geral, Precisa de você, Funil, Briefing, Revisão, Radar como aba, Minha operação", ["TorreVisaoGeral", "TorrePrecisaDeVoce", "TorreFunil", "TorreBriefing", "TorreRevisao", "TorreKpis"].every((n) => !arquivosTorre.some((a) => a.f === `${n}.tsx`)) && !/aba === "(radar|minha|visao|precisa)"/.test(casco) && !/OperacaoV3/.test(casco))

  secao("L1 — um contador/bloco em UM lugar só")
  ok("os seis alarmes de Hoje (cartões com número) só são desenhados por TorreHoje", contem("ALARMES_DE_HOJE").every((f) => ["TorreHoje.tsx", "Torre.tsx"].includes(f)) && contem("numeroDoAlarme").every((f) => f === "TorreHoje.tsx"))
  ok("nenhuma outra aba desenha os cartões da antiga Visão geral (Situação/Agenda) nem a faixa de KPIs", !contem("CARTOES_DA_SITUACAO").length && !contem("CARTOES_DA_AGENDA").length)
  const cartoesTerceiros = ["com cartórios", "com o cliente", "tradutora · juízo · consulado", "para cobrar hoje ou vencidas"]
  for (const t of cartoesTerceiros) ok(`o cartão de Terceiros "${t}" só existe em Terceiros`, contem(t).every((f) => f === "TorreTerceiros.tsx"))
  ok("Terceiros lista ÓRGÃOS (não tarefas): sem coluna de pedido nem 'por pedido'", /terceiros-orgaos/.test(ler(`${DIR}/TorreTerceiros.tsx`)) && !/por pedido|linhaDoPedido|CobrarPedidoModal/.test(ler(`${DIR}/TorreTerceiros.tsx`)))
  ok("Radar é uma VISTA de Famílias (alternador lista↔matriz), não aba", /Matriz \(família × fases\)/.test(ler(`${DIR}/TorreFamilias.tsx`)) && /<TorreRadar/.test(ler(`${DIR}/TorreFamilias.tsx`)))

  secao("L4 — só a aba Tarefas atribui (a Equipe e o 'Distribuir' do processo só PROPÕEM, com prévia e confirmação)")
  const atribui = arquivosTorre.filter((a) => /\/atribuir["`'/]|atribuir-sugerido|acao: "atribuir"|"ATRIBUIR"/.test(a.t)).map((a) => a.f).sort()
  ok("os arquivos da Torre que escrevem atribuição são só a família da aba Tarefas", atribui.every((f) => ["TorreTarefas.tsx", "PainelTorreTarefa.tsx", "ConfirmarAtribuicao.tsx"].includes(f)), atribui.join(", "))
  ok("toda atribuição por clique passa pelo modal de confirmação (useConfirmarAtribuicao)", ["TorreTarefas", "PainelTorreTarefa", "TorreEquipe", "EquipeModais", "TorreProcessoPagina"].every((n) => /useConfirmarAtribuicao\(\)/.test(ler(`${DIR}/${n}.tsx`))))
  ok("as decisões do processo e do Hoje não têm botão de atribuir (link 'Atribuir na Torre')", /Atribuir na Torre/.test(ler(`${DIR}/ProcessoDecisoes.tsx`)) && !/<button[^>]*>[^<]*Atribuir/.test(ler(`${DIR}/TorreHoje.tsx`)))

  secao("L3 (estático) — as listas leem a MESMA consulta")
  ok("a página do processo embute TorreTarefas e lê /api/torre/tarefas?processoId (a mesma consulta da aba)", /<TorreTarefas/.test(ler(`${DIR}/TorreProcessoPagina.tsx`)) && /api\/torre\/tarefas\?processoId=/.test(ler(`${DIR}/TorreProcessoPagina.tsx`)))
  ok("canceladas: a aba Tarefas e a página do processo usam UMA função (listarCanceladasDaTorre)", /listarCanceladasDaTorre/.test(ler("src/app/api/torre/tarefas/canceladas/route.ts")) && /listarCanceladasDaTorre/.test(ler("lib/operacional/torre-foco.ts")))

  // ───────────────────────────── banco de TESTE, dados semeados ─────────────────────────────
  exigirBancoDeTeste("torre-lei-duplicidade-e-contadores.test.ts")
  const { prisma } = await import("../lib/prisma")
  const { montarCenario } = await import("./_fixture-torre-gh")
  const { listarTarefasDaTorre } = await import("../src/services/torre-tarefas")
  const { listarCanceladasDaTorre } = await import("../src/services/torre-canceladas")
  const { detalheDoProcesso } = await import("../lib/operacional/torre-foco")
  const { resumoDeTerceiros, pedidosDeTerceiros } = await import("../lib/operacional/terceiros-pedidos")
  const { GET: getCanceladas } = await import("../src/app/api/torre/tarefas/canceladas/route")
  const { signAuthToken } = await import("../lib/auth-jwt")
  const { NextRequest } = await import("next/server")
  const MARCA = "LEIT"
  const DIA = 86_400_000
  const c = await montarCenario(MARCA)
  try {
    const admin = await prisma.usuario.create({ data: { nome: `${MARCA} Admin`, email: `${MARCA.toLowerCase()}-admin@t.com`, senha: "x", tipo: "admin" } })
    const dona = await prisma.usuario.create({ data: { nome: `${MARCA} Dona`, email: `${MARCA.toLowerCase()}-dona@t.com`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.iniciar_concluir": true, "tarefas.ver": true } } })
    const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: admin.tipo, sessaoInicio: Date.now() })
    const agora = new Date()

    // SEMENTES: atrasada, hoje, amanhã, sem responsável, bloqueada, aguardando com e sem responsável, cobrança vencida e uma cancelada.
    const t1 = await c.novaObrigacao({ responsavelId: dona.id, dataPrazo: new Date(agora.getTime() - 3 * DIA) })
    const t2 = await c.novaObrigacao({ responsavelId: dona.id, dataPrazo: new Date(agora.getTime()) })
    const t3 = await c.novaObrigacao({ responsavelId: dona.id, dataPrazo: new Date(agora.getTime() + DIA) })
    const t4 = await c.novaObrigacao({ responsavelId: null, dataPrazo: new Date(agora.getTime() + 5 * DIA) })
    const t5 = await c.novaObrigacao({ responsavelId: dona.id, dataPrazo: new Date(agora.getTime() + 5 * DIA) })
    const t6 = await c.novaObrigacao({ responsavelId: dona.id, aguardando: true })
    const t7 = await c.novaObrigacao({ responsavelId: null, aguardando: true })
    const t8 = await c.novaObrigacao({ responsavelId: dona.id })
    await prisma.tarefa.update({ where: { id: t5.tarefaId }, data: { statusTarefa: "BLOQUEADA" } })
    await prisma.tarefa.update({ where: { id: t8.tarefaId }, data: { statusTarefa: "CANCELADA" } })

    const { linhas } = await listarTarefasDaTorre({}, agora, { incluirPausados: true })
    const minhas = linhas.filter((l) => [t1, t2, t3, t4, t5, t6, t7].some((t) => t.tarefaId === l.taskId))
    secao("L3 — Hoje: o número de cada alarme = o tamanho da lista que o clique abre (a aba Tarefas filtrada pelo MESMO predicado)")
    for (const a of ALARMES_DE_HOJE) {
      const n = numeroDoAlarme(a, linhas, agora)
      // a aba Tarefas ao abrir o alarme: kpi → `linhasDoKpi`; visão → `predicadoDaVisao`; depois os filtros (vazios) da barra
      const base = a.abre.tipo === "kpi" ? linhasDoKpi(a.abre.kpi, linhas, agora) : linhas.filter(predicadoDaVisao(a.abre.visao, null, agora))
      const naAba = aplicarFiltros(base as never, filtrosVazios(), { usuarioId: null, agora }).mostrando
      ok(`"${a.rotulo}": número ${n} = lista da aba Tarefas ${naAba} = linhasDoAlarme ${linhasDoAlarme(a, linhas, agora).length}`, n === naAba && n === linhasDoAlarme(a, linhas, agora).length)
    }
    ok("os seis alarmes cabem em Hoje (no máximo 6 números)", ALARMES_DE_HOJE.length <= 6)
    ok("as sementes aparecem nos alarmes certos (atrasada, hoje, amanhã, sem responsável, bloqueada)", numeroDoAlarme(ALARMES_DE_HOJE[0], minhas, agora) >= 1 && numeroDoAlarme(ALARMES_DE_HOJE[1], minhas, agora) >= 1 && numeroDoAlarme(ALARMES_DE_HOJE[2], minhas, agora) >= 1 && numeroDoAlarme(ALARMES_DE_HOJE[3], minhas, agora) >= 1 && numeroDoAlarme(ALARMES_DE_HOJE[4], minhas, agora) >= 1)

    secao("L3 — Terceiros: o número de 'aguardando' = a visão 'Aguardando terceiros' da aba Tarefas = os pedidos da lista (antes 9 × 10)")
    const resumo = resumoDeTerceiros(linhas as never, agora)
    const visao = contagemDaVisao("aguard", linhas as never, null, agora)
    const pedidos = pedidosDeTerceiros(linhas as never, agora)
    ok(`resumo.aguardando ${resumo.aguardando} = visão aguard ${visao} = KPI aguard ${numeroDoKpi("aguard", linhas, agora)} = pedidos ${pedidos.length}`, resumo.aguardando === visao && visao === numeroDoKpi("aguard", linhas, agora) && visao === pedidos.length)
    ok("o pedido SEM responsável conta (cobrar um terceiro não depende de a tarefa ter dono)", pedidos.some((p) => p.taskId === t7.tarefaId))
    ok("os cartões por tipo repartem o total", resumo.comCartorios + resumo.comOCliente + resumo.tradutora + resumo.juizo + resumo.consulado === resumo.aguardando)

    secao("L3 — a página do processo: cartões, Próxima ação, 'Distribuir as N' e contadores saem da MESMA lista da tabela")
    const d = (await detalheDoProcesso(t4.processoId, agora))!
    const doProcesso = (await listarTarefasDaTorre({ processoId: t4.processoId }, agora, { incluirPausados: true })).linhas
    ok("Abertas e Sem responsável do cabeçalho = a lista do processo", d.numeros.abertas === doProcesso.length && d.numeros.semResponsavel === doProcesso.filter((l) => l.responsavelId == null).length, JSON.stringify(d.numeros))
    ok("Próxima ação conta o MESMO conjunto do botão 'Distribuir as N'", (d.proximaAcao == null) || /1/.test(d.proximaAcao.titulo) || d.numeros.semResponsavel === 1, d.proximaAcao?.titulo)
    ok("o cartão 'Com quem' diz o mesmo número de sem dono da lista", d.cartoes.find((x) => x.rotulo === "Com quem")?.sub.includes(`${doProcesso.filter((l) => l.responsavelId == null).length} sem dono`) === true)

    secao("L3 — Famílias › \"Onde estão as N certidões … por passo\": passos + sem responsável + concluídas = N (as de fase anterior entram)")
    {
      // 3 abertas na fase atual (2 com responsável no passo 1, 1 sem) + 2 da Genealogia reaberta com responsável (outro passo) + 1 sem responsável da Genealogia
      const mk = (id: number, fase: string, resp: number | null, passo: string) => ({ taskId: id, faseMacroKey: fase, responsavelId: resp, passoCorrente: { label: passo }, etapaAtual: passo, passoAtual: { ordem: 0, total: 1 }, estadoOperacao: "FILA", esperandoDe: null, esperandoHaDias: null, documentoId: id }) as never
      const daFase = [mk(1, "emissao_documental", 7, "Solicitar certidão"), mk(2, "emissao_documental", 7, "Solicitar certidão"), mk(3, "emissao_documental", null, "Solicitar certidão")]
      const todas = [...daFase, mk(4, "genealogia", 8, "Localizar registro da certidão"), mk(5, "genealogia", 8, "Localizar registro da certidão"), mk(6, "genealogia", null, "Localizar registro da certidão")]
      const t = tarefasDaFaseDoProcesso(daFase, 2, null, todas)
      const cartao = passosDaFase([{ tarefasDaFase: t } as never], null)
      ok(`passos (${cartao.caixas.filter((x) => x.chave !== "__concluidas").reduce((n, x) => n + x.n, 0)}) + sem responsável (${cartao.semResponsavel}) + concluídas = total ${cartao.total}`, somaExibidaDosPassos(cartao) === cartao.total && cartao.total === todas.length + 2, JSON.stringify(cartao.caixas.map((x) => [x.nome, x.n])))
      ok("o passo da Genealogia reaberta (as 2 com responsável) aparece no cartão — não ficam de fora", cartao.caixas.some((x) => /Localizar registro/.test(x.nome) && x.n === 2))
      ok("o título diz o que soma: 'dos processos desta fase'", /dos processos desta fase/.test(ler(`${DIR}/TorrePassosDaFase.tsx`)))
    }

    secao("L3 — o SELO da aba Tarefas é o total fixo das abertas; só o contador da visão muda com o filtro")
    {
      const total = numeroDoKpi("abertas", linhas, agora)
      const semResp = contagemDaVisao("semdono", linhas as never, null, agora)
      ok(`selo = total das abertas (${total}) mesmo com a visão 'Sem responsável' (${semResp}) ativa`, total === linhas.length && semResp < total && /const nTarefas = numeroDoKpi\("abertas", linhasPais, agora\)/.test(ler(`${DIR}/Torre.tsx`)))
    }

    secao("Equipe — o texto não cita tela que não existe")
    ok("nenhum texto da aba Equipe manda 'para o Precisa de você' (agora: 'você atribui em Tarefas')", !/(ficam|fica|continuam) (para|no) (o )?"?Precisa de você/.test(ler(`${DIR}/equipe-visual.ts`) + ler(`${DIR}/EquipeTabela.tsx`) + ler(`${DIR}/TorreEquipe.tsx`)))

    secao("L3 — Canceladas: a aba Tarefas e a página do processo mostram o MESMO número (UMA consulta)")
    const canc = await listarCanceladasDaTorre({ processoId: t8.processoId }, agora)
    const resp = await getCanceladas(new NextRequest(`http://localhost/api/torre/tarefas/canceladas?processoId=${t8.processoId}`, { headers: { Authorization: `Bearer ${token}` } }))
    const jResp = await resp.json()
    const dC = (await detalheDoProcesso(t8.processoId, agora))!
    const cardC = dC.cartoes.find((x) => /Cancelada/.test(x.rotulo))!
    ok(`aba Tarefas (rota) ${jResp.total} = função única ${canc.length} = card da página "${cardC.titulo}"`, jResp.total === canc.length && canc.length === 1 && /^1 cancelada/.test(cardC.titulo), `${jResp.total}/${canc.length}/${cardC.titulo}`)
    ok("a página lista as canceladas que o card conta (mesmas tarefas)", dC.encerradas.filter((e) => !e.semTarefa).length === canc.length && dC.encerradas.filter((e) => !e.semTarefa).every((e) => canc.some((l) => l.taskId === e.tarefaId)))
  } finally {
    await c.limpar()
    await prisma.logAuditoria.deleteMany({ where: { descricao: { contains: MARCA } } }).catch(() => null)
    await prisma.usuario.deleteMany({ where: { nome: { startsWith: MARCA } } }).catch(() => null)
  }
  console.log(`\n${falhou === 0 ? "✅" : "❌"} LEI DA TORRE — ${passou} ok, ${falhou} falhas`)
  if (falhou) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
