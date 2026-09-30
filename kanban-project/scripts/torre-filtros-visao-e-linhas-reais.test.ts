// scripts/torre-filtros-visao-e-linhas-reais.test.ts
// ============================================================================
// TORRE — SEÇÃO 3 (30/09/2026), PROVA NO BANCO DE TESTE: os filtros leem campos que EXISTEM nas linhas reais da Torre
// (`listarTarefasDaTorre`) e fecham com os cartões (mesma regra, mesmo número); a visão salva guarda TODOS os filtros pela API
// (POST → banco → GET), sem quebrar a visão antiga, e guarda a PERGUNTA — aplicada por outra pessoa, 'Eu' é quem abriu.
//
//   npx tsx scripts/torre-filtros-visao-e-linhas-reais.test.ts   (banco de teste)
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-filtros-visao-e-linhas-reais.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import { listarTarefasDaTorre } from "../src/services/torre-tarefas"
import { registrarCobranca } from "../src/services/subtarefas-da-etapa"
import { numeroDoKpi } from "../lib/operacional/torre-kpis"
import { aplicarFiltros, filtrosIguais, filtrosVazios, normalizarFiltros, textoMostrando, type FiltrosTorre } from "../lib/operacional/torre-filtros"
import { GET as getVisoes, POST as postVisao } from "../src/app/api/torre/visoes/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREFX"
const DIA = 86_400_000
const req = (method: string, url: string, token: string | null, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })

async function main() {
  const c = await montarCenario(MARCA)
  try {
    const mk = (nome: string) => prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo: "admin" } })
    const ana = await mk("Ana"), beto = await mk("Beto")
    const tAna = await tokenDe(ana), tBeto = await tokenDe(beto)

    secao("Linhas reais: os campos que os filtros leem existem e fecham com os cartões")
    const vencida = await c.novaObrigacao({ dataPrazo: new Date(Date.now() - 3 * DIA) })                               // sem dono, atrasada
    const daAna = await c.novaObrigacao({ responsavelId: ana.id, dataPrazo: new Date(Date.now() + 2 * DIA) })
    const doBeto = await c.novaObrigacao({ responsavelId: beto.id })                                                   // sem prazo
    const cart = await c.novaObrigacao({ aguardando: true, responsavelId: ana.id, dataPrazo: new Date(Date.now() + 9 * DIA) })
    await prisma.subtaskExecution.updateMany({ where: { stepInstanceId: cart.stepInstanceId, subtaskKey: "aguardar_retorno", supersededAt: null }, data: { proximoAcompanhamentoEm: new Date(Date.now() - DIA) } })
    const esc = await c.novaObrigacao({ aguardando: true, responsavelId: beto.id, dataPrazo: new Date(Date.now() + 12 * DIA) })
    await registrarCobranca({ stepInstanceId: esc.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA" })
    await registrarCobranca({ stepInstanceId: esc.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA" })

    const agora = new Date()
    const linhas = (await listarTarefasDaTorre({}, agora)).linhas
    const meus = linhas.filter((l) => l.processoNome?.startsWith(MARCA))
    const ctxAna = { usuarioId: ana.id, agora }
    const N = (f: Partial<FiltrosTorre>, ctx = ctxAna) => aplicarFiltros(linhas, { ...filtrosVazios(), ...f }, ctx)
    ok("as 5 tarefas do cenário estão na lista real", meus.length === 5, `${meus.length}`)
    ok("as linhas reais trazem os campos lidos pelos filtros", linhas.every((l) => "responsavelId" in l && "dataPrazo" in l && "criadaEm" in l && "atribuidaEm" in l && "familiaNome" in l && "statusTarefa" in l && "categoriaDoc" in l && "faseMacroKey" in l && "passoCorrente" in l && "orgaoId" in l && "terceiroNome" in l && "prioridade" in l && "emRisco" in l && "linhaReta" in l && "acompanhamentoVencido" in l && "acompanhamentoPasso" in l && "cobravelVencida" in l && "escalada" in l))
    ok("Responsável 'eu' = as tarefas de quem está logado", N({ responsavel: ["eu"] }).linhas.every((l) => l.responsavelId === ana.id) && N({ responsavel: ["eu"] }).mostrando === linhas.filter((l) => l.responsavelId === ana.id).length)
    ok("'eu' depende de quem olha (Beto vê as dele)", N({ responsavel: ["eu"] }, { usuarioId: beto.id, agora }).linhas.every((l) => l.responsavelId === beto.id))
    ok("'Sem responsável' = cartão 'Sem ninguém' (mesma regra)", N({ responsavel: ["sem"] }).mostrando === numeroDoKpi("ninguem", linhas, agora))
    ok("Prazo 'Vencidas' = cartão 'Atrasadas'; 'Hoje', 'Amanhã' e 'Sem prazo' = os da Agenda", N({ prazo: ["vencidas"] }).mostrando === numeroDoKpi("venc", linhas, agora) && N({ prazo: ["hoje"] }).mostrando === numeroDoKpi("hoje", linhas, agora) && N({ prazo: ["amanha"] }).mostrando === numeroDoKpi("amanha", linhas, agora) && N({ prazo: ["sem"] }).mostrando === numeroDoKpi("sprazo", linhas, agora))
    ok("a atrasada do cenário é 'vencida' e 'crítico'", N({ prazo: ["vencidas"] }).linhas.some((l) => l.taskId === vencida.tarefaId) && N({ risco: ["critico"] }).linhas.some((l) => l.taskId === vencida.tarefaId))
    ok("Prazo 7 dias pega a de +2 e não a de +9", N({ prazo: ["7dias"] }).linhas.some((l) => l.taskId === daAna.tarefaId) && !N({ prazo: ["7dias"] }).linhas.some((l) => l.taskId === cart.tarefaId) && N({ prazo: ["30dias"] }).linhas.some((l) => l.taskId === cart.tarefaId))
    ok("Sem prazo pega a do Beto", N({ prazo: ["sem"] }).linhas.some((l) => l.taskId === doBeto.tarefaId))
    ok("Status: AGUARDANDO_TERCEIRO = as 'Com o cartório' do cenário", N({ status: ["AGUARDANDO_TERCEIRO"] }).linhas.filter((l) => l.processoNome?.startsWith(MARCA)).length === 2)
    ok("Acompanhamento vencido = a flag canônica (e só a do cenário com data no passado)", N({ acomp: ["vencido"] }).linhas.some((l) => l.taskId === cart.tarefaId) && N({ acomp: ["vencido"] }).linhas.every((l) => l.acompanhamentoVencido))
    ok("Cobrança vencida = cartão 'Cobranças a fazer'; sem resposta = cartão 'Escaladas'", N({ cobranca: ["vencida"] }).mostrando === numeroDoKpi("cob", linhas, agora) && N({ cobranca: ["semresposta"] }).mostrando === numeroDoKpi("esc", linhas, agora) && N({ cobranca: ["semresposta"] }).linhas.some((l) => l.taskId === esc.tarefaId))
    ok("Família (contém): o nome do processo do cenário, sem caixa", N({ familia: MARCA.toLowerCase() }).linhas.every((l) => (l.familiaNome ?? l.processoNome ?? "").toLowerCase().includes(MARCA.toLowerCase())) && N({ familia: MARCA.toLowerCase() }).mostrando >= 5)
    const tudo: Partial<FiltrosTorre> = { responsavel: ["eu"], prazo: ["7dias", "30dias"], status: ["AGUARDANDO_TERCEIRO", "EM_ANDAMENTO", "NAO_INICIADA"], familia: MARCA.toLowerCase(), ordenar: "prazo" }
    const comb = N(tudo)
    ok("combinados (AND): só as da Ana, com prazo em 30 dias, da família; ordenadas por prazo", comb.linhas.length >= 1 && comb.linhas.every((l) => l.responsavelId === ana.id && l.dataPrazo != null) && comb.linhas.every((l, i, a) => i === 0 || Date.parse(a[i - 1].dataPrazo as string) <= Date.parse(l.dataPrazo as string)) && comb.total === linhas.length)
    ok("'Mostrando N de M' = tamanho da lista que a tabela desenha, de M abertas", textoMostrando(comb) === `Mostrando ${comb.linhas.length} de ${linhas.length}`)

    secao("Visão salva pela API: TODOS os filtros, ida (POST → banco) e volta (GET)")
    const filtros: FiltrosTorre = {
      responsavel: ["eu", String(beto.id)], prazo: ["vencidas", "7dias"], prazoDe: "2026-10-01", prazoAte: "2026-12-31", quando: "criada", quandoDe: "2026-09-01", quandoAte: "2026-12-31", familia: "Santin",
      status: ["AGUARDANDO_TERCEIRO"], certidao: ["CASAMENTO", "OUTRO"], fase: ["emissao_documental"], passo: ["Aguardar retorno"], orgao: ["sem"], prioridade: ["ALTA"], risco: ["critico"],
      linhaReta: true, acomp: ["vencido", "3dias"], cobranca: ["vencida", "semresposta"], ordenar: "risco",
    }
    const r1 = await postVisao(req("POST", "/api/torre/visoes", tAna, { nome: "Tudo", visao: "minhas", agrupar: "resp", dentro: "none", kpi: "venc", pais: "Espanha", busca: "cibils", filtros, compartilhada: true }))
    const criada = await r1.json()
    ok("POST 200 e devolve os filtros validados, iguais aos enviados", r1.status === 200 && filtrosIguais(normalizarFiltros(criada.visao.spec.filtros), filtros))
    const linhaBanco = await prisma.relatorioVisao.findUniqueOrThrow({ where: { id: criada.visao.id } })
    ok("o banco guarda a pergunta (spec JSON, sem migration — mesma tabela `RelatorioVisao`, domínio torre-tarefas)", linhaBanco.dominio === "torre-tarefas" && filtrosIguais(normalizarFiltros((linhaBanco.spec as { filtros: Record<string, unknown> }).filtros), filtros))
    ok("guarda 'eu' como 'eu' (não o id de quem salvou) e nunca o resultado (sem ids de tarefa no spec)", (linhaBanco.spec as { filtros: { responsavel: string[] } }).filtros.responsavel[0] === "eu" && !/taskId|tarefaId|linhas/.test(JSON.stringify(linhaBanco.spec)))
    const aud = await prisma.logAuditoria.findFirst({ where: { acao: "VISAO_TORRE_SALVA", entidadeId: criada.visao.id } })
    ok("a gravação é auditada COM os filtros (LogAuditoria.detalhes.spec.filtros)", aud != null && filtrosIguais(normalizarFiltros(((aud.detalhes as { spec: { filtros: Record<string, unknown> } }).spec.filtros)), filtros))
    const lista = await (await getVisoes(req("GET", "/api/torre/visoes", tBeto))).json()
    const vista = lista.compartilhadas.find((v: { id: number }) => v.id === criada.visao.id)
    ok("GET (outra pessoa, visão compartilhada) devolve os mesmos filtros", vista != null && filtrosIguais(normalizarFiltros(vista.spec.filtros), filtros))
    const especifica: Partial<FiltrosTorre> = { responsavel: ["eu"], prazo: ["7dias", "30dias"] }
    const salvaEsp = await (await postVisao(req("POST", "/api/torre/visoes", tAna, { nome: "Minhas até 30 dias", visao: "todas", filtros: { ...filtrosVazios(), ...especifica }, compartilhada: true }))).json()
    const listaBeto = await (await getVisoes(req("GET", "/api/torre/visoes", tBeto))).json()
    const specEsp = normalizarFiltros(listaBeto.compartilhadas.find((v: { id: number }) => v.id === salvaEsp.visao.id).spec.filtros)
    const comoAna = aplicarFiltros(linhas, specEsp, ctxAna), comoBeto = aplicarFiltros(linhas, specEsp, { usuarioId: beto.id, agora })
    ok("a visão guarda a PERGUNTA: aplicada por outra pessoa, 'Eu' é quem abriu (Ana vê as dela, Beto as dele)", comoAna.linhas.every((l) => l.responsavelId === ana.id) && comoBeto.linhas.every((l) => l.responsavelId === beto.id) && comoAna.linhas.length > 0 && comoBeto.linhas.length > 0)
    const lixo = await (await postVisao(req("POST", "/api/torre/visoes", tAna, { nome: "Lixo", filtros: { prazo: ["x"], risco: ["y"], status: ["Z"], quando: "iniciada", quandoDe: "2026-01-01", responsavel: ["../x"], ordenar: "sql", prazoDe: "2026-13-45" } }))).json()
    ok("valor fora da lista é normalizado na gravação (nada arbitrário chega ao banco)", filtrosIguais(normalizarFiltros(lixo.visao.spec.filtros), filtrosVazios()) && filtrosIguais(lixo.visao.spec.filtros, filtrosVazios()))
    const antiga = await (await postVisao(req("POST", "/api/torre/visoes", tAna, { nome: "Sem barra", visao: "vencidas", agrupar: "org", dentro: "passo" }))).json()
    ok("visão sem `filtros` (a de antes da barra) continua salvando e volta como 'nenhum filtro'", antiga.visao.spec.visao === "vencidas" && antiga.visao.spec.dentro === "passo" && filtrosIguais(antiga.visao.spec.filtros, filtrosVazios()))
    await prisma.relatorioVisao.update({ where: { id: antiga.visao.id }, data: { spec: { visao: "vencidas", agrupar: "org", dentro: "passo", kpi: null, pais: null, busca: null } } })
    const lidaAntiga = (await (await getVisoes(req("GET", "/api/torre/visoes", tAna))).json()).minhas.find((v: { id: number }) => v.id === antiga.visao.id)
    ok("uma visão JÁ salva no formato antigo (linha no banco sem `filtros`) é lida sem erro e vale 'nenhum filtro'", lidaAntiga != null && filtrosIguais(normalizarFiltros(lidaAntiga.spec.filtros), filtrosVazios()))
  } finally {
    await prisma.relatorioVisao.deleteMany({ where: { dominio: "torre-tarefas" } })
    await prisma.logAuditoria.deleteMany({ where: { acao: { in: ["VISAO_TORRE_SALVA", "VISAO_COMPARTILHADA", "VISAO_TORRE_REMOVIDA"] } } })
    await c.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
