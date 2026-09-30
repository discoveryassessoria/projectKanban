// scripts/torre-bloco-h-regras.test.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO H3 (30/09/2026) — as TRÊS regras (r1, r2, r3).
//
//   npx tsx scripts/torre-bloco-h-regras.test.ts   (banco de teste)
//
// PROVA:
//   • existem SÓ r1, r2, r3 — e nascem: r1 DESLIGADA, r2 ATIVA, r3 DESLIGADA;
//   • REGRA DESLIGADA NÃO EXECUTA NADA: r1 desligada não atribui nem audita; r2 desligada
//     registra o contato mas não reagenda nem escala; r3 desligada não segura ninguém;
//   • ativar/desativar é auditado (quem, antes → depois) e idempotente;
//   • SIMULAR usa os dados de hoje e nunca grava — nem com a regra ligada;
//   • r2 lê o CADASTRO REAL (nenhum número do protótipo);
//   • r3 segura quem está no limite; o cron não faz nada com a regra desligada.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bloco-h-regras.test.ts")

import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { montarCenario } from "./_fixture-torre-gh"
import {
  CHAVES_REGRA, PADRAO_REGRA, lerRegras, regraAtiva, definirRegra, executarR1, simularRegra, lerReguaDeCobranca, textoDaRegua, ehChaveRegra,
} from "../lib/operacional/regras-torre"
import { definirCapacidade } from "../lib/operacional/organizacao"
import { registrarCobranca } from "../src/services/subtarefas-da-etapa"
import { GET as getRegras } from "../src/app/api/torre/regras/route"
import { POST as postAtivar } from "../src/app/api/torre/regras/[chave]/ativar/route"
import { POST as postSimular } from "../src/app/api/torre/regras/[chave]/simular/route"
import { POST as postExecutarR1 } from "../src/app/api/torre/regras/r1/executar/route"
import { GET as getCron } from "../src/app/api/cron/torre-regras/route"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORREH2"
const DIA = 86_400_000

const req = (method: string, url: string, token: string | null, body?: unknown, extra: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...extra },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
const tokenDe = (u: { id: number; email: string; tipo: string }) => signAuthToken({ userId: u.id, email: u.email, tipo: u.tipo, sessaoInicio: Date.now() })

/** Uma "foto" de tudo o que uma regra poderia escrever — para provar que NADA mudou. */
const foto = async () => JSON.stringify({
  tarefas: await prisma.tarefa.findMany({ orderBy: { id: "asc" }, select: { id: true, responsavelId: true, lockVersion: true, dataPrazo: true } }),
  logs: await prisma.logAuditoria.count(),
  contatos: await prisma.contatoTerceiro.count(),
  exec: (await prisma.subtaskExecution.findMany({ orderBy: { id: "asc" }, select: { id: true, escalada: true, proximoAcompanhamentoEm: true } })),
})

async function main() {
  // Régua do CADASTRO com números que NÃO são os do protótipo (que dizia "cobrar a cada 1 d", "10 d").
  const c = await montarCenario(MARCA, { diasAposCobranca: 3, escalarApos: 2 })
  try {
    const mk = (nome: string, tipo: string, perms?: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const EXEC = { "tarefas.iniciar_concluir": true, "tarefas.ver": true }
    const admin = await mk("Admin", "admin")
    const gestor = await mk("Gestor", "assistente", { "tarefas.ver": true, "operacao.distribuirTarefas": true })
    const ana = await mk("Ana", "assistente", EXEC)
    const beto = await mk("Beto", "assistente", EXEC)
    const tAdmin = await tokenDe(admin), tGestor = await tokenDe(gestor)

    secao("SÓ TRÊS REGRAS, com o estado inicial do mandato")
    ok("as chaves são exatamente r1, r2, r3 (nada de r4, r5 nem 'tempo aprendido')", JSON.stringify([...CHAVES_REGRA]) === '["r1","r2","r3"]')
    ok("r4 e r5 não são regras", !ehChaveRegra("r4") && !ehChaveRegra("r5"))
    const inicial = await lerRegras()
    ok("r1 nasce DESLIGADA", inicial.find((r) => r.chave === "r1")!.ativa === false && PADRAO_REGRA.r1 === false)
    ok("r2 nasce ATIVA", inicial.find((r) => r.chave === "r2")!.ativa === true)
    ok("r3 nasce DESLIGADA", inicial.find((r) => r.chave === "r3")!.ativa === false)
    ok("nasceram por PADRÃO (nenhuma linha gravada; nenhum ato de ninguém)", inicial.every((r) => r.padrao))
    const rGet = await (await getRegras(req("GET", "/api/torre/regras", tAdmin))).json()
    ok("a rota lista só as 3", rGet.regras.length === 3 && rGet.regras.every((r: { chave: string }) => ["r1", "r2", "r3"].includes(r.chave)))
    ok("gestor sem usuarios.gerenciar não vê as regras (403)", (await getRegras(req("GET", "/api/torre/regras", tGestor))).status === 403)
    ok("regra desconhecida: 404 (r4)", (await postAtivar(req("POST", "/api/torre/regras/r4/ativar", tAdmin, { ativa: true }), { params: Promise.resolve({ chave: "r4" }) })).status === 404)
    ok("simular r5: 404", (await postSimular(req("POST", "/api/torre/regras/r5/simular", tAdmin), { params: Promise.resolve({ chave: "r5" }) })).status === 404)
    ok("ativar sem booleano: 400", (await postAtivar(req("POST", "/api/torre/regras/r1/ativar", tAdmin, { ativa: "sim" }), { params: Promise.resolve({ chave: "r1" }) })).status === 400)

    secao("r2 LÊ O CADASTRO REAL (nenhum número do protótipo)")
    const regua = await lerReguaDeCobranca()
    const texto = textoDaRegua(regua)
    ok("a régua traz o passo publicado do Gerenciamento", regua.some((l) => l.passoKey === "solicitar_certidao" && l.diasAposCobranca === 3 && l.escalarApos === 2 && l.diasParaIniciar === 2))
    ok("o texto usa os números do CADASTRO (3 d / 2ª), não os do protótipo", /cobrar a cada 3 d/.test(texto) && /escalar na 2ª sem resposta/.test(texto) && !/cobrar a cada 1 d/.test(texto) && !/10 d/.test(texto), texto.slice(0, 200))
    const sintetica = textoDaRegua([1, 2, 3, 4, 5].map((n) => ({ workflow: "w", passoKey: `k${n}`, passo: `Passo ${n}`, diasParaIniciar: 2, diasAposCobranca: 1, escalarApos: 2, esperas: ["Receber: acompanhar em 7 d"] })))
    ok("passos com a mesma régua viram UMA frase (não 5 repetidas) e a espera aparece uma vez", (sintetica.match(/cobrar a cada 1 d/g) ?? []).length === 1 && /\+2/.test(sintetica) && (sintetica.match(/Receber: acompanhar em 7 d/g) ?? []).length === 1, sintetica)
    ok("e as esperas cadastradas nas subtarefas", regua[0].esperas.some((e) => /acompanhar em 5 d/.test(e)))
    ok("a descrição que a tela recebe é a mesma lida do cadastro", /cobrar a cada 3 d/.test(rGet.regras.find((r: { chave: string }) => r.chave === "r2").descricao))

    secao("REGRA DESLIGADA NÃO EXECUTA NADA — r1")
    // Três tarefas SEM DONO, na fase atual dos processos.
    await c.novaObrigacao({}); await c.novaObrigacao({}); await c.novaObrigacao({})
    const f0 = await foto()
    const semExecutar = await executarR1(admin.id)
    ok("executarR1 com a regra desligada devolve REGRA_DESLIGADA", semExecutar.executou === false && semExecutar.motivo === "REGRA_DESLIGADA")
    ok("e NADA mudou no banco (nenhuma atribuição, nenhuma auditoria)", (await foto()) === f0)
    const rExe = await postExecutarR1(req("POST", "/api/torre/regras/r1/executar", tAdmin))
    ok("a rota 'aplicar agora' com r1 desligada: 409 e nada muda", rExe.status === 409 && (await foto()) === f0)
    ok("o cron sem credencial: 401", (await getCron(req("GET", "/api/cron/torre-regras", null))).status === 401)
    const rCron = await getCron(req("GET", "/api/cron/torre-regras", null, undefined, { "x-vercel-cron": "1" }))
    const jCron = await rCron.json()
    ok("o cron com r1 desligada não faz nada", rCron.status === 200 && jCron.r1.executou === false && (await foto()) === f0)

    secao("SIMULAR usa os dados de hoje e NUNCA grava")
    const s1 = await simularRegra("r1")
    ok("r1: 'hoje, N tarefa(s) sem dono seriam atribuídas', com os números reais", s1.numeros.semDono === 3 && s1.numeros.atribuiria === 3 && /3 tarefa\(s\) sem dono seriam atribuídas/.test(s1.texto), s1.texto)
    ok("r1 desligada: a simulação responde do mesmo jeito e informa que está desligada", s1.ativaAgora === false)
    const s2 = await simularRegra("r2")
    ok("r2: aplica a régua do cadastro às solicitações abertas de hoje", /cobrar a cada 3 d/.test(s2.texto) && s2.numeros.passosComRegua >= 1 && s2.ativaAgora === true)
    const s3 = await simularRegra("r3")
    ok("r3 sem limites cadastrados: diz que não teria o que aplicar", /Nenhuma pessoa tem limite/.test(s3.texto))
    ok("nenhuma das três simulações gravou nada", (await foto()) === f0)
    for (const k of ["r1", "r2", "r3"]) {
      const rs = await postSimular(req("POST", `/api/torre/regras/${k}/simular`, tAdmin), { params: Promise.resolve({ chave: k }) })
      ok(`rota simular ${k}: 200 e sem escrita`, rs.status === 200 && (await foto()) === f0)
    }

    secao("ATIVAR / DESATIVAR: auditado, idempotente")
    const ligar = await postAtivar(req("POST", "/api/torre/regras/r1/ativar", tAdmin, { ativa: true }), { params: Promise.resolve({ chave: "r1" }) })
    ok("ativar r1 (200)", ligar.status === 200 && (await regraAtiva("r1")) === true)
    const audLigar = await prisma.logAuditoria.findMany({ where: { entidade: "RegraTorre", acao: "REGRA_TORRE_ATIVADA" } })
    ok("auditoria: quem, quando, antes → depois", audLigar.length === 1 && audLigar[0].usuarioId === admin.id && (audLigar[0].detalhes as { de: boolean; para: boolean }).de === false && (audLigar[0].detalhes as { para: boolean }).para === true && /r1/.test(audLigar[0].descricao))
    const denovo = await definirRegra("r1", true, admin.id)
    ok("ativar de novo é idempotente (não duplica a auditoria)", denovo.ok && denovo.mudou === false && (await prisma.logAuditoria.count({ where: { entidade: "RegraTorre", acao: "REGRA_TORRE_ATIVADA" } })) === 1)
    ok("agora a regra deixou de ser 'padrão' e guarda quem mexeu", (await lerRegras()).find((r) => r.chave === "r1")!.padrao === false && (await lerRegras()).find((r) => r.chave === "r1")!.atualizadoPorId === admin.id)

    secao("r1 LIGADA: atribui a quem a regra sugere, auditado, idempotente")
    const plano = await simularRegra("r1")
    ok("a simulação com r1 ligada mostra o que seria feito", plano.ativaAgora === true && plano.numeros.atribuiria === 3)
    const exec1 = await executarR1(admin.id)
    ok("executa: 3 atribuídas", exec1.executou === true && exec1.atribuidas === 3, JSON.stringify(exec1).slice(0, 160))
    // Candidatos = quem tem permissão de executar (o administrador tem todas — inclusive o do seed do banco de teste).
    const candidatos = (await prisma.usuario.findMany({ where: { OR: [{ tipo: "admin" }, { id: { in: [ana.id, beto.id] } }] }, select: { id: true } })).map((u) => u.id)
    const donos = await prisma.tarefa.findMany({ where: { workflowStepInstanceId: { not: null }, processo: { nome: { startsWith: MARCA } }, responsavelId: { not: null } }, select: { responsavelId: true } })
    ok("as 3 tarefas têm dono, e é sempre alguém apto e disponível", donos.length === 3 && donos.every((d) => candidatos.includes(d.responsavelId as number)), JSON.stringify({ donos, candidatos, gestor: gestor.id }))
    ok("a regra balanceia por carga (não empilha as 3 numa pessoa só)", new Set(donos.map((d) => d.responsavelId)).size >= 2, JSON.stringify(donos.map((d) => d.responsavelId)))
    ok("cada atribuição tem a sua auditoria, com o motivo da regra", (await prisma.logAuditoria.count({ where: { acao: "TAREFA_ATRIBUIDA", descricao: { contains: "" }, detalhes: { path: ["motivo"], string_contains: "auto-atribuição (regra r1)" } } })) === 3)
    ok("e um resumo da execução", (await prisma.logAuditoria.count({ where: { acao: "REGRA_TORRE_EXECUTADA" } })) === 1)
    const exec2 = await executarR1(admin.id)
    ok("rodar de novo não atribui nada (nada sem dono)", exec2.executou === true && exec2.atribuidas === 0)
    const rCronLigada = await (await getCron(req("GET", "/api/cron/torre-regras", null, undefined, { "x-vercel-cron": "1" }))).json()
    ok("o cron, com r1 ligada, executa (e é idempotente)", rCronLigada.r1.executou === true && rCronLigada.r1.atribuidas === 0)

    secao("r3 — LIMITE DE CARGA: segura quem está no limite (só junto com a atribuição automática)")
    // TODOS os candidatos com limite 1 e 1 executável cada → todos no limite.
    for (const uid of candidatos) {
      await definirCapacidade({ usuarioId: uid, limiteExecutaveis: 1, autorId: admin.id })
      await c.novaObrigacao({ responsavelId: uid })
    }
    await c.novaObrigacao({}); await c.novaObrigacao({})
    const r3Off = await executarR1(admin.id)
    ok("r3 DESLIGADA: o limite é ignorado e as novas são atribuídas mesmo a quem está no limite", r3Off.executou === true && r3Off.atribuidas === 2 && r3Off.seguradas === 0, JSON.stringify(r3Off).slice(0, 120))
    await c.novaObrigacao({}); await c.novaObrigacao({})
    await definirRegra("r3", true, admin.id)
    const simR3 = await simularRegra("r3")
    ok("r3: a simulação diz quem está no limite e quantas novas seriam seguradas", simR3.numeros.noLimite === candidatos.length && simR3.numeros.seguradas === 2 && /Precisa de você/.test(simR3.texto), simR3.texto)
    const f1 = await foto()
    ok("simular r3 não grava", (await foto()) === f1)
    const r3On = await executarR1(admin.id)
    ok("r3 LIGADA: as novas ficam SEGURADAS (sem dono, para decisão em 'Precisa de você')", r3On.executou === true && r3On.atribuidas === 0 && r3On.seguradas === 2, JSON.stringify({ a: r3On.executou && r3On.atribuidas, s: r3On.executou && r3On.seguradas }))
    ok("segurar não escreveu nas tarefas (a foto é a mesma, exceto o resumo auditado)", (await prisma.tarefa.count({ where: { responsavelId: null, workflowStepInstanceId: { not: null }, processo: { nome: { startsWith: MARCA } } } })) === 2)
    await definirRegra("r3", false, admin.id)
    await definirRegra("r1", false, admin.id)
    const desligadaDeNovo = await executarR1(admin.id)
    ok("desativar r1 de volta: volta a não executar nada", desligadaDeNovo.executou === false)
    ok("desativar também é auditado", (await prisma.logAuditoria.count({ where: { entidade: "RegraTorre", acao: "REGRA_TORRE_DESATIVADA" } })) === 2)

    secao("r2 — RÉGUA DE COBRANÇA: ligada age; DESLIGADA registra o contato mas não age")
    const onA = await c.novaObrigacao({ aguardando: true })
    const antesOn = await prisma.subtaskExecution.findFirstOrThrow({ where: { stepInstanceId: onA.stepInstanceId, subtaskKey: "aguardar_retorno", supersededAt: null } })
    const ini = Date.now()
    const c1 = await registrarCobranca({ stepInstanceId: onA.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA" })
    const c2 = await registrarCobranca({ stepInstanceId: onA.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA" })
    ok("r2 ATIVA (padrão): reagenda o acompanhamento em 3 dias (o cadastro) e ESCALA na 2ª sem resposta", c1.ok && c2.ok && c2.escalada === true
      && Math.abs((c2.proximoAcompanhamentoEm?.getTime() ?? 0) - (ini + 3 * DIA)) < 10_000, JSON.stringify(c2))
    void antesOn

    await definirRegra("r2", false, admin.id)
    const offA = await c.novaObrigacao({ aguardando: true })
    const antesOff = await prisma.subtaskExecution.findFirstOrThrow({ where: { stepInstanceId: offA.stepInstanceId, subtaskKey: "aguardar_retorno", supersededAt: null } })
    const o1 = await registrarCobranca({ stepInstanceId: offA.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA" })
    const o2 = await registrarCobranca({ stepInstanceId: offA.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA" })
    const o3 = await registrarCobranca({ stepInstanceId: offA.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA" })
    const depoisOff = await prisma.subtaskExecution.findFirstOrThrow({ where: { stepInstanceId: offA.stepInstanceId, subtaskKey: "aguardar_retorno", supersededAt: null } })
    ok("r2 DESLIGADA: o contato é REGISTRADO (fato histórico; ninguém apaga fato com interruptor)", o1.ok && o2.ok && o3.ok && (await prisma.contatoTerceiro.count({ where: { tarefaId: offA.tarefaId } })) === 3)
    ok("r2 DESLIGADA: a régua NÃO age — não escala, mesmo com 3 sem resposta (escalar na 2ª)", o3.ok && o3.escalada === false && depoisOff.escalada === false && o3.cobrancasSemResposta === 3)
    ok("r2 DESLIGADA: não reagenda o acompanhamento", (depoisOff.proximoAcompanhamentoEm?.getTime() ?? null) === (antesOff.proximoAcompanhamentoEm?.getTime() ?? null))
    await definirRegra("r2", true, admin.id)
    const o4 = await registrarCobranca({ stepInstanceId: offA.stepInstanceId, subtaskKey: "aguardar_retorno", canal: "EMAIL", resultado: "SEM_RESPOSTA" })
    ok("religar r2: a régua volta a agir (escala com as sem resposta acumuladas)", o4.ok && o4.escalada === true)
    ok("a simulação de r2 informa quantas já estão escaladas hoje", (await simularRegra("r2")).numeros.escaladas >= 2)
  } finally {
    await c.limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
