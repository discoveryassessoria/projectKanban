// scripts/torre-bloco-j-kpis-radar-visoes-absorcao.test.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO J (30/09/2026) — KPIs, tendência, Radar/Processos, países, visões salvas e a absorção.
//
//   npx tsx scripts/torre-bloco-j-kpis-radar-visoes-absorcao.test.ts   (banco de teste)
//
// PROVA:
//   J3  o NÚMERO de cada KPI é a contagem da lista que ele filtra (mesma função nos dois lados) e igual à foto E10;
//       a tendência é REAL (foto de ~7 dias atrás) ou "sem histórico" — nunca estimada;
//   J4  Radar/Processos vêm das fontes que já existem (risco = score do "Precisa de você"; colunas = cadastro);
//       visões salvas: sem migration (RelatorioVisao), compartilháveis, só o dono altera/remove;
//   J2  países = os CADASTRADOS na oferta;
//   J5  a absorção leva SÓ o administrador à Torre — quem não é admin fica na tela de hoje.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bloco-j-kpis-radar-visoes-absorcao.test.ts")

import { readFileSync } from "node:fs"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { KPIS, CARTOES_DA_SITUACAO, CARTOES_DA_AGENDA, kpisDasLinhas, totaisDaSituacao, linhasDoKpi, processosEmRisco, vence7, tendenciaDe, fotoDeReferencia, CAMPO_DA_FOTO, type ChaveKpi, type CampoDaFoto } from "../lib/operacional/torre-kpis"
import { calcularIndicadoresDoDia } from "../lib/operacional/indicadores-diarios"
import { tendenciasDaTorre } from "../lib/operacional/torre-tendencias"
import { processosDaTorre, bolaDoProcesso, processosCriticos, anotarRisco, certidoesDosProcessos } from "../lib/operacional/torre-processos"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { registrarCobranca } from "../src/services/subtarefas-da-etapa"
import { nacionalidadesOfertadas } from "../src/lib/relatorios/motor/opcoes"
import { destinoDaAbsorcao, DESTINO_NA_TORRE } from "../src/lib/torre-absorcao"
import { GET as getPaises } from "../src/app/api/torre/paises/route"
import { GET as getProcessos } from "../src/app/api/torre/processos/route"
import { GET as getTendencias } from "../src/app/api/torre/tendencias/route"
import { GET as getVisoes, POST as postVisao, PATCH as patchVisao, DELETE as delVisao } from "../src/app/api/torre/visoes/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREJ1"
const DIA = 86_400_000
const req = (method: string, url: string, token: string | null, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })

async function main() {
  const c = await montarCenario(MARCA)
  try {
    const mk = (nome: string, tipo: string, perms?: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const admin = await mk("Admin", "admin")
    const outro = await mk("Outro", "admin")
    const comum = await mk("Comum", "assistente", { "tarefas.ver": true })
    const tAdmin = await tokenDe(admin), tOutro = await tokenDe(outro), tComum = await tokenDe(comum)

    // ═══════════ J3 — KPIs ═══════════
    secao("J3 — as fronteiras dos predicados (puro)")
    ok("vence7: hoje (0) e 7 dias entram; 8 não; atrasada nunca; sem prazo nunca", vence7({ atrasada: false, diasParaPrazo: 0 }) && vence7({ atrasada: false, diasParaPrazo: 7 }) && !vence7({ atrasada: false, diasParaPrazo: 8 }) && !vence7({ atrasada: true, diasParaPrazo: -2 }) && !vence7({ atrasada: false, diasParaPrazo: null }))
    ok("o topo novo tem 4+6 cartões de tarefa (+ o selo de risco); as chaves antigas seguem válidas (URL, visões, foto); só 'abertas' e 'back' não filtram", CARTOES_DA_SITUACAO.join() === "abertas,equipe,cartorio,ninguem" && CARTOES_DA_AGENDA.join() === "venc,hoje,amanha,prox7,sprazo,cob" && ["v7", "semdono", "aguard", "esc", "back", "risco"].every((c) => KPIS.some((k) => k.chave === c)) && KPIS.filter((k) => !k.filtra).map((k) => k.chave).sort().join() === "abertas,back")

    secao("J3 — o número bate com a lista que o cartão filtra")
    const ontem = new Date(Date.now() - 2 * DIA)
    const vencida = await c.novaObrigacao({ dataPrazo: ontem })                                     // atrasada + sem dono
    const vence3 = await c.novaObrigacao({ responsavelId: admin.id, dataPrazo: new Date(Date.now() + 3 * DIA) })
    const vence20 = await c.novaObrigacao({ responsavelId: admin.id, dataPrazo: new Date(Date.now() + 20 * DIA) })
    const cart = await c.novaObrigacao({ aguardando: true, responsavelId: admin.id, dataPrazo: new Date(Date.now() + 9 * DIA) })
    await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: cart.stepInstanceId, subtaskKey: "aguardar_retorno", supersededAt: null }, data: { proximoAcompanhamentoEm: ontem } })
    const esc = await c.novaObrigacao({ aguardando: true, responsavelId: admin.id, dataPrazo: new Date(Date.now() + 9 * DIA) })
    await registrarCobranca({ stepInstanceId: esc.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA" })
    await registrarCobranca({ stepInstanceId: esc.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA" })

    const linhas = anotarRisco((await listarTarefasDaTorre({})).linhas, await processosCriticos())
    const K = kpisDasLinhas(linhas)
    const KF = { ...K, ...totaisDaSituacao(linhas) } // os campos da foto: os 7 KPIs + os totais da Visão geral (M4)
    const chaves: Array<[ChaveKpi, number]> = [["venc", K.vencidas], ["v7", K.vencemEm7Dias], ["semdono", K.semDono], ["aguard", K.aguardandoTerceiro], ["cob", K.cobrancasPendentes], ["esc", K.escaladas]]
    for (const [k, n] of chaves) ok(`${k}: o número do cartão = o tamanho da lista filtrada`, linhasDoKpi(k, linhas).length === n, `${n}`)
    ok("risco: o número = nº de PROCESSOS; a lista filtrada = as tarefas desses processos", K.emRisco === processosEmRisco(linhas).size && linhasDoKpi("risco", linhas).every((l) => l.processoId != null && processosEmRisco(linhas).has(l.processoId)))
    ok("os dados esperados: 1 atrasada, ≥1 vence em 7 dias (a de 3 dias, não a de 20), ≥1 sem dono, 2 com o cartório, 1 cobrança vencida, 1 escalada",
      K.vencidas === 1 && linhasDoKpi("v7", linhas).some((l) => l.taskId === vence3.tarefaId) && !linhasDoKpi("v7", linhas).some((l) => l.taskId === vence20.tarefaId) && K.semDono >= 1 && K.aguardandoTerceiro === 2 && K.cobrancasPendentes === 1 && K.escaladas === 1,
      JSON.stringify(K))
    ok("'Atrasadas' não repete o que vence em 7 dias", !linhasDoKpi("v7", linhas).some((l) => l.taskId === vencida.tarefaId))
    ok("o backlog NÃO filtra (devolve a lista inteira)", linhasDoKpi("back", linhas).length === linhas.length)
    const foto = await calcularIndicadoresDoDia()
    ok("a foto diária (E10) usa a MESMA função: cada campo = o número do cartão", (Object.keys(CAMPO_DA_FOTO) as Array<keyof typeof CAMPO_DA_FOTO>).every((k) => { const c = CAMPO_DA_FOTO[k]! as Exclude<CampoDaFoto, 'processosAtivos'>; return foto[c] === KF[c] }))

    secao("J3 — a tendência é REAL ou 'sem histórico'")
    ok("sem foto de referência: null (a tela não mostra tendência alguma)", tendenciaDe(5, null) === null && tendenciaDe(5, undefined) === null)
    ok("subiu / desceu / igual, com o delta", tendenciaDe(8, 6)!.rotulo === "▲ +2 vs semana passada" && tendenciaDe(8, 6)!.direcao === "up" && tendenciaDe(3, 8)!.rotulo === "▼ −5 vs semana passada" && tendenciaDe(3, 8)!.direcao === "down" && tendenciaDe(6, 6)!.direcao === "igual")
    const hoje = new Date("2026-10-10T12:00:00Z")
    const f = (d: string) => ({ data: d })
    ok("a referência é a foto de 7 a 10 dias atrás; mais nova (5 d) ou mais velha (12 d) não serve", fotoDeReferencia([f("2026-10-05")], hoje) === null && fotoDeReferencia([f("2026-09-28")], hoje) === null && fotoDeReferencia([f("2026-10-03")], hoje)?.data === "2026-10-03" && fotoDeReferencia([f("2026-10-02"), f("2026-10-03")], hoje)?.data === "2026-10-03")
    await prisma.torreIndicadorDiario.deleteMany({})
    const semHist = await tendenciasDaTorre()
    ok("sem nenhuma foto: referencia null; o backlog vem ao vivo", semHist.referencia === null && typeof semHist.backlog.abertas === "number")
    const dia = (d: number) => { const x = new Date(); x.setUTCHours(0, 0, 0, 0); return new Date(x.getTime() - d * DIA) }
    const base = { vencidas: 9, vencemEm7Dias: 1, semDono: 2, aguardandoTerceiro: 3, cobrancasPendentes: 4, escaladas: 5, emRisco: 6, backlogAbertas: 7, backlogFechadasNaSemana: 8 }
    await prisma.torreIndicadorDiario.create({ data: { data: dia(8), ...base } })
    await prisma.torreIndicadorDiario.create({ data: { data: dia(2), ...base, vencidas: 100 } })
    const comHist = await tendenciasDaTorre()
    ok("com foto de 8 dias atrás: é ELA a referência (a de 2 dias não)", comHist.referencia?.vencidas === 9 && comHist.fotosNaSerie === 2)
    ok("a rota devolve o mesmo (gestor da Torre) e recusa quem não é", (await (await getTendencias(req("GET", "/api/torre/tendencias", tAdmin))).json()).referencia?.vencidas === 9 && (await getTendencias(req("GET", "/api/torre/tendencias", tComum))).status === 403)

    // ═══════════ J2 — PAÍSES ═══════════
    secao("J2 — países cadastrados")
    const semOferta = await prisma.catalogoPais.create({ data: { countryKey: `${MARCA.toLowerCase()}_x`, countryLabel: `${MARCA} Sem oferta`, nationalityKey: "x", nationalityLabel: "x" } })
    const rp = await (await getPaises(req("GET", "/api/torre/paises", tAdmin))).json()
    const ofertados = await nacionalidadesOfertadas()
    ok("são os países da OFERTA (Tipo de Processo ativo) — a mesma lista dos Relatórios", JSON.stringify(rp.paises.map((p: { chave: string }) => p.chave)) === JSON.stringify(ofertados.map((o) => o.valor)) && rp.paises.length >= 1)
    ok("país sem tipo de processo ativo NÃO aparece", !rp.paises.some((p: { chave: string }) => p.chave === semOferta.countryKey))
    ok("usuário sem acesso à Torre: 403", (await getPaises(req("GET", "/api/torre/paises", tComum))).status === 403)

    // ═══════════ J4 — RADAR E PROCESSOS ═══════════
    secao("J4 — bola do processo (puro)")
    const L = (o: Partial<{ estadoOperacao: "FILA" | "AGUARDANDO" | "CONCLUIDA"; esperandoDe: "terceiro" | "cliente" | null; esperandoHaDias: number | null }>) => ({ estadoOperacao: "FILA" as const, esperandoDe: null, esperandoHaDias: null, ...o })
    ok("metade ou mais esperando o terceiro → Cartório (com os dias da maior espera)", JSON.stringify(bolaDoProcesso([L({ esperandoDe: "terceiro", esperandoHaDias: 4 }), L({ esperandoDe: "terceiro", esperandoHaDias: 9 }), L({})])) === '{"rotulo":"Cartório","dias":9}')
    ok("esperando o cliente → Cliente; senão Nossa; sem tarefas → Nossa", bolaDoProcesso([L({ esperandoDe: "cliente", esperandoHaDias: 2 })]).rotulo === "Cliente" && bolaDoProcesso([L({}), L({})]).rotulo === "Nossa" && bolaDoProcesso([]).rotulo === "Nossa")

    secao("J4 — Radar e Processos vêm das fontes existentes")
    // Um macrofluxo real para o tipo do teste: genealogia → emissão → análise → apostilamento.
    const macro = await prisma.macroWorkflow.findFirstOrThrow({ where: { tipoProcessoId: c.tipoId }, select: { id: true } })
    let ordem = 1
    for (const k of ["genealogia", "emissao_documental", "analise_documental", "apostilamento", "finalizado"]) {
      await prisma.faseMacro.upsert({ where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: k } }, update: { ordem }, create: { macroWorkflowId: macro.id, phaseKey: k, label: k, ordem } })
      ordem++
    }
    const familia = await prisma.familia.create({ data: { nome: `${MARCA} Família` } })
    const pCrit = await c.novaObrigacao({ dataPrazo: ontem })                                                    // sem dono (3) + vencida (4) = 7
    const pAten = await c.novaObrigacao({ dataPrazo: new Date(Date.now() + 15 * DIA) })                          // sem dono = 3
    const pOk = await c.novaObrigacao({ responsavelId: admin.id, dataPrazo: new Date(Date.now() + 15 * DIA) })   // nada
    for (const p of [pCrit, pAten, pOk]) await prisma.processo.update({ where: { id: p.processoId }, data: { faseAtualKey: "emissao_documental" } })
    await prisma.processo.update({ where: { id: pCrit.processoId }, data: { familiaId: familia.id, codigo: `${MARCA}-1` } })
    // Achado do Saúde: a fase 'apostilamento' não tem passo executável (a "parede à frente").
    const achado = await prisma.saudeAchado.create({ data: { chave: `${MARCA}::cad012`, codigo: "CAD-012", dominio: "BANCO", modulo: "t", severidade: "ERRO", titulo: `${MARCA} sem passos`, descricao: "d", evidencia: { fase: "apostilamento" }, versaoCatalogo: "t" } })
    const r = await processosDaTorre()
    const ids = new Set([pCrit.processoId, pAten.processoId, pOk.processoId])
    const linha = (id: number) => r.processos.find((p) => p.processoId === id)!
    // Torre nova: a fase TERMINAL (a última de todo macrofluxo em que aparece e sem processo ativo nela — aqui, "finalizado") não é coluna: processo que chega lá está concluído.
    ok("as colunas do Radar são as fases ATIVAS do cadastro (na ordem padrão) menos a terminal — não uma lista no código", JSON.stringify(r.colunas.map((x) => x.key)) === JSON.stringify((await prisma.catalogoFase.findMany({ where: { ativo: true }, orderBy: [{ ordemPadrao: "asc" }, { id: "asc" }] })).map((x) => x.phaseKey).filter((k) => k !== "finalizado")) && r.colunas.length >= 9)
    ok("risco = o score do 'Precisa de você': crítico / atenção / ok", linha(pCrit.processoId).risco === "critico" && linha(pAten.processoId).risco === "atencao" && linha(pOk.processoId).risco === "ok", JSON.stringify([linha(pCrit.processoId).scoreMaximo, linha(pAten.processoId).scoreMaximo, linha(pOk.processoId).scoreMaximo]))
    ok("ordenado do pior para o melhor", r.processos.filter((p) => ids.has(p.processoId)).map((p) => p.risco).join() === "critico,atencao,ok")
    const cel = (id: number, key: string) => linha(id).celulas[r.colunas.findIndex((x) => x.key === key)]
    ok("célula da fase ATUAL: com quem está a bola e há quantos dias, com a cor do risco", cel(pCrit.processoId, "emissao_documental").estado === "atual" && cel(pCrit.processoId, "emissao_documental").bola === "Nossa" && cel(pCrit.processoId, "emissao_documental").risco === "critico" && (cel(pCrit.processoId, "emissao_documental").dias === null || cel(pCrit.processoId, "emissao_documental").dias === undefined ? true : typeof cel(pCrit.processoId, "emissao_documental").dias === "number"))
    ok("fase anterior = feita; posterior = futura; fase que o macrofluxo do tipo não tem = n/a", cel(pCrit.processoId, "genealogia").estado === "feita" && cel(pCrit.processoId, "analise_documental").estado === "futura" && cel(pCrit.processoId, "protocolado").estado === "na")
    ok("fase futura com achado aberto CAD-012 → 'sem passos'; sem achado → não", cel(pCrit.processoId, "apostilamento").semPassos === true && cel(pCrit.processoId, "analise_documental").semPassos === false)
    await prisma.saudeAchado.update({ where: { id: achado.id }, data: { status: "IGNORADO", ignoradoAte: new Date(Date.now() + 3 * DIA) } })
    ok("achado IGNORADO (prazo vigente) não pinta a fase", (await processosDaTorre()).processos.find((p) => p.processoId === pCrit.processoId)!.celulas[r.colunas.findIndex((x) => x.key === "apostilamento")].semPassos === false)
    await prisma.saudeAchado.update({ where: { id: achado.id }, data: { ignoradoAte: new Date(Date.now() - 1000) } })
    ok("…e VOLTA a pintar quando o prazo vence", (await processosDaTorre()).processos.find((p) => p.processoId === pCrit.processoId)!.celulas[r.colunas.findIndex((x) => x.key === "apostilamento")].semPassos === true)
    const pl = linha(pCrit.processoId)
    // Torre nova: o "a de b" das certidões saiu da lista leve (fonte única, pedida só para a página — `certidoesDosProcessos`) e o "próximo marco" virou a PRÓXIMA AÇÃO derivada.
    const [certPl] = await certidoesDosProcessos([pCrit.processoId])
    ok("cabeçalho da linha: família, código, fase, dias na fase, requerentes, tarefas da fase e próxima ação; certidões pela fonte única", pl.familiaNome === `${MARCA} Família` && pl.codigo === `${MARCA}-1` && pl.faseAtual.key === "emissao_documental" && (pl.diasNaFase === null ? pl.naFase.desde === null : typeof pl.diasNaFase === "number") && typeof pl.requerentes === "number" && "proximaAcao" in pl && typeof pl.tarefasDaFase.abertas === "number" && typeof certPl.requeridas === "number")
    const linhasAba = (await listarTarefasDaTorre({})).linhas.filter((l) => l.processoId === pCrit.processoId)
    ok("os 4 números de cada processo batem com a aba Tarefas", JSON.stringify(pl.numeros) === JSON.stringify({ abertas: linhasAba.length, vencidas: linhasAba.filter((l) => l.atrasada).length, comCartorio: linhasAba.filter((l) => l.estadoOperacao === "AGUARDANDO").length, semResponsavel: linhasAba.filter((l) => l.responsavelId == null).length }))
    const criticosAgora = (await processosDaTorre()).processos.filter((p) => p.risco === "critico").length
    const linhasAgora = anotarRisco((await listarTarefasDaTorre({})).linhas, await processosCriticos())
    ok("'Processos em risco' (cartão) = os processos de risco CRÍTICO do Radar e da aba Processos — a mesma palavra em todo lugar", kpisDasLinhas(linhasAgora).emRisco === criticosAgora && criticosAgora >= 1, `${criticosAgora}`)
    ok("…e o cartão filtra as tarefas exatamente desses processos", linhasDoKpi("risco", linhasAgora).every((l) => linhasAgora.some((x) => x.processoId === l.processoId && x.processoEmRisco)) && new Set(linhasDoKpi("risco", linhasAgora).map((l) => l.processoId)).size === criticosAgora)
    const foto2 = await calcularIndicadoresDoDia()
    ok("…e a foto E10 grava o mesmo número", foto2.emRisco === criticosAgora)
    const rota = await (await getProcessos(req("GET", "/api/torre/processos", tAdmin))).json()
    ok("rota: mesma resposta; sem acesso → 403", rota.processos.length === r.processos.length && (await getProcessos(req("GET", "/api/torre/processos", tComum))).status === 403)

    // ═══════════ J4 — VISÕES SALVAS ═══════════
    secao("J4 — visões salvas (RelatorioVisao, sem migration)")
    ok("sem acesso à Torre: 403", (await getVisoes(req("GET", "/api/torre/visoes", tComum))).status === 403)
    ok("sem nome: 400", (await postVisao(req("POST", "/api/torre/visoes", tAdmin, { nome: " ", visao: "vencidas" }))).status === 400)
    const criada = await (await postVisao(req("POST", "/api/torre/visoes", tAdmin, { nome: "Espanha atrasadas", visao: "vencidas", agrupar: "resp", kpi: "venc", pais: "Espanha", busca: "cibils" }))).json()
    ok("salva a PERGUNTA (visão, agrupamento, KPI, país, busca)", criada.visao.spec.visao === "vencidas" && criada.visao.spec.agrupar === "resp" && criada.visao.spec.kpi === "venc" && criada.visao.spec.pais === "Espanha" && criada.visao.spec.busca === "cibils" && criada.visao.compartilhada === false)
    const lixo = await (await postVisao(req("POST", "/api/torre/visoes", tAdmin, { nome: "Lixo", visao: "DROP", agrupar: "x", kpi: "back" }))).json()
    ok("valores fora da lista fechada são normalizados (nada de spec arbitrária); 'back' não filtra, então não é KPI salvável", lixo.visao.spec.visao === "todas" && lixo.visao.spec.agrupar === "fam" && lixo.visao.spec.kpi === null)
    ok("vive na tabela existente (dominio torre-tarefas) e a criação foi auditada", (await prisma.relatorioVisao.count({ where: { dominio: "torre-tarefas", usuarioId: admin.id } })) === 2 && (await prisma.logAuditoria.count({ where: { acao: "VISAO_TORRE_SALVA", usuarioId: admin.id } })) === 2)
    ok("privada: o outro admin NÃO a vê", (await (await getVisoes(req("GET", "/api/torre/visoes", tOutro))).json()).compartilhadas.length === 0)
    ok("compartilhar: só o dono (o outro não consegue)", (await patchVisao(req("PATCH", "/api/torre/visoes", tOutro, { id: criada.visao.id, compartilhada: true }))).status === 404 && (await patchVisao(req("PATCH", "/api/torre/visoes", tAdmin, { id: criada.visao.id, compartilhada: true }))).status === 200)
    const doOutro = await (await getVisoes(req("GET", "/api/torre/visoes", tOutro))).json()
    ok("compartilhada: aparece para a equipe com o nome do dono (e não duplica na lista do dono)", doOutro.compartilhadas.some((v: { nome: string; donoNome: string }) => v.nome === "Espanha atrasadas" && v.donoNome === `${MARCA} Admin`) && (await (await getVisoes(req("GET", "/api/torre/visoes", tAdmin))).json()).compartilhadas.length === 0)
    ok("compartilhamento auditado", (await prisma.logAuditoria.count({ where: { acao: "VISAO_COMPARTILHADA", entidadeId: criada.visao.id } })) === 1)
    ok("excluir: o outro não pode; o dono pode (auditado)", (await delVisao(req("DELETE", `/api/torre/visoes?id=${criada.visao.id}`, tOutro))).status === 404 && (await delVisao(req("DELETE", `/api/torre/visoes?id=${criada.visao.id}`, tAdmin))).status === 200 && (await prisma.logAuditoria.count({ where: { acao: "VISAO_TORRE_REMOVIDA" } })) === 1)

    // ═══════════ J5 — ABSORÇÃO ═══════════
    secao("J5 — a absorção leva SÓ o administrador à Torre")
    ok("admin: /tarefas → Torre (aba Tarefas)", destinoDaAbsorcao("/tarefas", "admin") === DESTINO_NA_TORRE["/tarefas"] && /^\/torre\?aba=tarefas/.test(destinoDaAbsorcao("/tarefas", "admin")!))
    ok("admin: /operacao/distribuicao → Torre (Tarefas filtrada por 'Sem responsável')", destinoDaAbsorcao("/operacao/distribuicao", "admin") === "/torre?aba=tarefas&kpi=semdono")
    for (const tipo of ["assistente", "operacional", "gestor", "", null, undefined]) {
      ok(`NÃO-admin (${JSON.stringify(tipo)}) fica onde está: nenhum destino, nas duas rotas`, destinoDaAbsorcao("/tarefas", tipo as never) === null && destinoDaAbsorcao("/operacao/distribuicao", tipo as never) === null)
    }
    const fonte = (p: string) => readFileSync(p, "utf8")
    for (const [arq, rota] of [["src/app/tarefas/page.tsx", "/tarefas"], ["src/app/operacao/distribuicao/page.tsx", "/operacao/distribuicao"]] as const) {
      const s = fonte(arq)
      ok(`${arq}: consulta a função de absorção e só redireciona quando ela devolve destino`, s.includes(`destinoDaAbsorcao("${rota}", user.tipo)`) && /if \(mounted && !carregando && paraTorre\) \{ router\.replace\(paraTorre\)/.test(s))
      ok(`${arq}: continua com o código da tela de hoje (nada apagado)`, /<VisaoGlobal|<DistribuicaoTarefas/.test(s))
    }
    const menu = fonte("src/components/bitrix-sidebar.tsx")
    const iOp = menu.indexOf('title: "Operação"'), iTorre = menu.indexOf('title: "Torre de Controle"'), iCal = menu.indexOf('title: "Calendário"')
    ok("menu: 'Torre de Controle' entre Operação e Calendário, e SÓ para administrador", iOp > 0 && iOp < iTorre && iTorre < iCal && /title: "Torre de Controle",[\s\S]{0,260}soAdmin: true/.test(menu))
    ok("'Tarefas e Projetos' e 'Distribuição' continuam no menu (nada apagado)", menu.includes('title: "Tarefas e Projetos"') && menu.includes('title: "Distribuição"'))
    void outro
    await prisma.familia.deleteMany({ where: { nome: { startsWith: MARCA } } })
    await prisma.catalogoPais.delete({ where: { id: semOferta.id } }).catch(() => {})
  } finally {
    await prisma.saudeAchado.deleteMany({ where: { chave: { startsWith: MARCA } } })
    await prisma.torreIndicadorDiario.deleteMany({})
    await prisma.relatorioVisao.deleteMany({ where: { dominio: "torre-tarefas" } })
    await prisma.logAuditoria.deleteMany({ where: { acao: { in: ["VISAO_TORRE_SALVA", "VISAO_COMPARTILHADA", "VISAO_TORRE_REMOVIDA"] } } })
    await c.limpar()
    await prisma.familia.deleteMany({ where: { nome: { startsWith: MARCA } } })
    await prisma.catalogoPais.deleteMany({ where: { countryKey: { startsWith: MARCA.toLowerCase() } } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
