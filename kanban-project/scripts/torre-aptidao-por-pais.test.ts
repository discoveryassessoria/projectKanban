// scripts/torre-aptidao-por-pais.test.ts
// ============================================================================
// TORRE NOVA, ETAPA A (01/10/2026) — APTIDÃO OPERACIONAL POR PAÍS (M3): "apto em Itália".
//
//   npx tsx scripts/torre-aptidao-por-pais.test.ts   (banco de teste)
//
// PROVA:
//   • a MESMA política opt-in da aptidão por unidade: país em que ninguém foi declarado apto NÃO restringe; com ao menos um
//     apto declarado, só os declarados passam — e o apto vence quem tem menos carga mas não é apto;
//   • SEM cadastro nenhum → "sem aptidão cadastrada" (fallback explícito) e a regra automática (r1) NUNCA atribui: continua em
//     "Precisa de você" — manter o que foi decidido na r1;
//   • soma com a aptidão por unidade (as duas regras valem juntas), o ausente só passa para sucessor também apto no país;
//   • a elegibilidade (`simularTarefa`) reprova quem não é apto no país e diz por quê;
//   • escrita: lista inteira, país inexistente/inativo recusado, só grava histórico quando algo mudou (quem, o quê, quando);
//   • mover carteira / simular saída só absorvem o que o sucessor é apto a executar (inclui o país).
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-aptidao-por-pais.test.ts")

import { prisma } from "../lib/prisma"
import {
  escolherResponsavel, textoDaSugestao, sugerirResponsavelPrecisaDeVoce,
  type ContextoDeSugestao,
} from "../lib/operacional/precisa-de-voce"
import { definirAptidoesPais, lerOrganizacao, paisesComAptidaoDeclarada, paisesDasTarefas, definirAptidoes } from "../lib/operacional/organizacao"
import { simularTarefa } from "../lib/operacional/elegibilidade"
import { planoDaR1 } from "../lib/operacional/regras-torre"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

// ─── A REGRA PURA, com um contexto montado à mão (sem banco) ────────────────
type U = ContextoDeSugestao["usuarios"][number]
const EXEC = { "tarefas.iniciar_concluir": true }
const usuario = (id: number, nome: string, tipo = "assistente", permissoesCustom: unknown = EXEC): U => ({ id, nome, tipo, permissoesCustom, perfil: null })
const ITALIA = 1, ESPANHA = 2
const NOMES: Record<number, string> = { [ITALIA]: "Itália", [ESPANHA]: "Espanha" }
const org = (id: number, nome: string, o: { aptidoes?: number[]; paises?: number[]; ausenteCom?: number | null } = {}) => ({
  usuarioId: id, nome, equipes: [], aptidoes: o.aptidoes ?? [], aptidoesDetalhadas: [],
  paisesAptos: o.paises ?? [], paisesAptosDetalhados: (o.paises ?? []).map((p) => ({ paisId: p, nome: NOMES[p] })),
  indisponivelPor: o.ausenteCom === undefined ? null
    : { id: 1, tipo: "FERIAS" as const, inicio: "", fim: null, motivo: null, sucessorSugerido: o.ausenteCom == null ? null : { usuarioId: o.ausenteCom, nome: `U${o.ausenteCom}` } },
  indisponibilidades: [], limiteExecutaveis: null, observacaoCapacidade: null,
})
function contexto(args: { usuarios: U[]; ativas?: Record<number, number>; paises?: Record<number, number[]>; aptidoes?: Record<number, number[]>; ausentes?: Record<number, number | null> }): ContextoDeSugestao {
  const organizacao = new Map(args.usuarios.map((u) => [u.id, org(u.id, u.nome, { paises: args.paises?.[u.id], aptidoes: args.aptidoes?.[u.id], ausenteCom: args.ausentes && u.id in args.ausentes ? args.ausentes[u.id] : undefined })]))
  return {
    organizacao: organizacao as never, usuarios: args.usuarios,
    ativasPorUsuario: new Map(Object.entries(args.ativas ?? {}).map(([k, v]) => [Number(k), v])),
    atribuicoes30dPorUsuario: new Map(),
    unidadesComAptidao: new Set([...organizacao.values()].flatMap((o) => o.aptidoes)),
    paisesComAptidao: new Set([...organizacao.values()].flatMap((o) => o.paisesAptos)),
    rotulos: new Map([[7, { perfilOperacionalId: 7, code: "ES", nome: "Emissão", familia: null }]]) as never,
    equipes: new Map(),
  }
}
const alvo = (paisId: number | null, unidadeOperacionalId: number | null = null) => ({ unidadeOperacionalId, equipeExigida: null, paisId })

async function main() {
  secao("PURO — há apto no país → só os aptos, o de MENOR carga entre eles")
  const admin = usuario(1, "Marco Admin", "admin", null)
  const ctx = contexto({ usuarios: [admin, usuario(2, "Dani"), usuario(3, "Beto"), usuario(4, "Cris")], ativas: { 2: 5, 3: 2, 4: 0 }, paises: { 2: [ITALIA], 3: [ITALIA, ESPANHA] } })
  const sIt = escolherResponsavel(ctx, alvo(ITALIA))
  ok("Itália: Beto (apto, 2 ativas) — não a Cris (0, sem aptidão) nem o admin (0)", sIt?.usuarioId === 3 && sIt.fallback !== true, JSON.stringify(sIt))
  ok("o motivo e o texto citam o país: 'apto em Itália'", /apto em Itália/.test(sIt?.motivo ?? "") && textoDaSugestao(sIt) === "Sugiro Beto: 2 ativa(s), apto em Itália", textoDaSugestao(sIt) ?? "")
  const sEs = escolherResponsavel(ctx, alvo(ESPANHA))
  ok("Espanha: só o Beto é apto → ele, mesmo havendo gente com menos carga", sEs?.usuarioId === 3 && /apto em Espanha/.test(sEs.motivo))
  ok("quem NÃO é apto no país nunca é sugerido: com os dois aptos ocupados, ainda assim não cai na Cris", ![4, 1].includes(escolherResponsavel(contexto({ usuarios: [admin, usuario(2, "Dani"), usuario(4, "Cris")], ativas: { 2: 50, 4: 0 }, paises: { 2: [ITALIA] } }), alvo(ITALIA))?.usuarioId ?? 0))

  secao("PURO — SEM cadastro: 'sem aptidão cadastrada', nunca o administrador")
  const semCad = contexto({ usuarios: [admin, usuario(2, "Dani"), usuario(3, "Beto")], ativas: { 2: 3, 3: 1 } })
  const fb = escolherResponsavel(semCad, alvo(ITALIA))
  ok("país sem nenhum apto declarado NÃO restringe: cai no fallback explícito por menor carga (Beto)", fb?.usuarioId === 3 && fb.fallback === true)
  ok("o texto diz 'Sem aptidão cadastrada' (vocabulário oficial)", textoDaSugestao(fb) === "Sem aptidão cadastrada para esta tarefa; sugiro Beto por menor carga (1 ativa(s)).", textoDaSugestao(fb) ?? "")
  ok("o administrador (carga 0) fica de fora do fallback", escolherResponsavel(contexto({ usuarios: [admin, usuario(2, "Dani")], ativas: { 2: 9 } }), alvo(ITALIA))?.usuarioId === 2)
  ok("tarefa SEM país: o critério não se aplica (fallback; o apto de Itália não vira apto a tudo)", escolherResponsavel(ctx, alvo(null))?.fallback === true)
  ok("contexto antigo (sem 'paisesComAptidao') se comporta como antes: a aptidão por país não restringe", (() => { const c = contexto({ usuarios: [usuario(2, "Dani")], paises: { 2: [ITALIA] } }); delete (c as { paisesComAptidao?: unknown }).paisesComAptidao; return escolherResponsavel(c, alvo(ESPANHA))?.fallback === true })())

  secao("PURO — soma com a aptidão por unidade; ausente só passa para sucessor também apto")
  const dupla = contexto({ usuarios: [usuario(2, "Dani"), usuario(3, "Beto"), usuario(4, "Cris")], ativas: { 2: 1, 3: 1, 4: 0 }, aptidoes: { 2: [7], 3: [7] }, paises: { 3: [ITALIA], 4: [ITALIA] } })
  ok("com regra de unidade E de país, só quem é apto nas DUAS passa (Beto)", escolherResponsavel(dupla, alvo(ITALIA, 7))?.usuarioId === 3)
  ok("tarefa de OUTRO país (sem regra lá) volta a ser só pela unidade (menor carga entre os aptos à unidade)", [2, 3].includes(escolherResponsavel(dupla, alvo(ESPANHA, 7))?.usuarioId ?? 0))
  const aus = contexto({ usuarios: [usuario(2, "Dani"), usuario(3, "Beto"), usuario(4, "Cris")], ativas: { 2: 0, 3: 5, 4: 1 }, paises: { 2: [ITALIA], 3: [ITALIA] }, ausentes: { 2: 4 } })
  ok("o apto de menor carga está ausente e o sucessor (Cris) NÃO é apto na Itália → segue o ranking: Beto (apto, disponível)", escolherResponsavel(aus, alvo(ITALIA))?.usuarioId === 3)
  const aus2 = contexto({ usuarios: [usuario(2, "Dani"), usuario(3, "Beto")], ativas: { 2: 0, 3: 5 }, paises: { 2: [ITALIA], 3: [ITALIA] }, ausentes: { 2: 3 } })
  ok("o sucessor também é apto → vira a sugestão", escolherResponsavel(aus2, alvo(ITALIA))?.usuarioId === 3)

  // ─── BANCO ─────────────────────────────────────────────────────────────────
  const MARCA = "TORREA_PAIS_"
  const limpar = async () => {
    await prisma.logAuditoria.deleteMany({ where: { acao: "APTIDAO_PAIS_ALTERADA" } })
    await prisma.aptidaoOperacionalPais.deleteMany({})
    await prisma.aptidaoOperacional.deleteMany({ where: { usuario: { email: { startsWith: MARCA } } } })
    await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
    await prisma.processo.deleteMany({ where: { nome: { startsWith: MARCA } } })
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } })
    await prisma.catalogoPais.deleteMany({ where: { countryKey: { startsWith: "torrea_" } } })
  }
  await limpar()
  try {
    secao("BANCO — cadastro (escrita, histórico, validações)")
    const mk = (nome: string, tipo: string, perms: Record<string, boolean> | null) =>
      prisma.usuario.create({ data: { nome: `${MARCA}${nome}`, email: `${MARCA}${nome}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const adminDb = await mk("Admin", "admin", null)
    const apto = await mk("Apto", "assistente", EXEC)
    const outro = await mk("Outro", "assistente", EXEC)
    const demais = await prisma.usuario.findMany({ where: { id: { notIn: [adminDb.id, apto.id, outro.id] } }, select: { id: true } })
    for (const u of demais) for (let i = 0; i < 6; i++) await prisma.tarefa.create({ data: { titulo: `${MARCA}carga-${u.id}-${i}`, responsavelId: u.id, statusTarefa: "EM_ANDAMENTO" } })
    for (let i = 0; i < 3; i++) await prisma.tarefa.create({ data: { titulo: `${MARCA}carga-apto-${i}`, responsavelId: apto.id, statusTarefa: "EM_ANDAMENTO" } })

    const pIt = await prisma.catalogoPais.create({ data: { countryKey: "torrea_italia", countryLabel: `${MARCA}Itália`, nationalityKey: "torrea_it", nationalityLabel: "x" } })
    const pEs = await prisma.catalogoPais.create({ data: { countryKey: "torrea_espanha", countryLabel: `${MARCA}Espanha`, nationalityKey: "torrea_es", nationalityLabel: "x" } })
    const pOff = await prisma.catalogoPais.create({ data: { countryKey: "torrea_inativo", countryLabel: `${MARCA}Inativo`, nationalityKey: "torrea_in", nationalityLabel: "x", ativo: false } })

    ok("país inexistente → recusa e nada grava", (await definirAptidoesPais(apto.id, [99999999], adminDb.id)).ok === false && (await prisma.aptidaoOperacionalPais.count()) === 0)
    ok("país INATIVO → recusa", (await definirAptidoesPais(apto.id, [pOff.id], adminDb.id)).ok === false)
    ok("usuário inexistente → recusa", (await definirAptidoesPais(99999999, [pIt.id], adminDb.id)).ok === false)
    const r1 = await definirAptidoesPais(apto.id, [pIt.id, pEs.id], adminDb.id)
    ok("declara apto em Itália e Espanha", r1.ok && r1.adicionados.length === 2 && r1.removidos.length === 0 && (await prisma.aptidaoOperacionalPais.count({ where: { usuarioId: apto.id } })) === 2)
    const r2 = await definirAptidoesPais(apto.id, [pIt.id], adminDb.id)
    ok("a lista é INTEIRA: sem a Espanha → a Espanha sai (sem sobra)", r2.ok && r2.removidos.join() === String(pEs.id) && (await prisma.aptidaoOperacionalPais.count({ where: { usuarioId: apto.id } })) === 1)
    const logsAntes = await prisma.logAuditoria.count({ where: { acao: "APTIDAO_PAIS_ALTERADA" } })
    const r3 = await definirAptidoesPais(apto.id, [pIt.id], adminDb.id)
    ok("repetir a mesma lista não muda nada e NÃO grava histórico novo", r3.ok && r3.adicionados.length === 0 && r3.removidos.length === 0 && (await prisma.logAuditoria.count({ where: { acao: "APTIDAO_PAIS_ALTERADA" } })) === logsAntes)
    const logs = await prisma.logAuditoria.findMany({ where: { acao: "APTIDAO_PAIS_ALTERADA", entidadeId: apto.id }, orderBy: { id: "asc" } })
    ok("histórico: quem fez, o que mudou, quando", logs.length === 2 && logs.every((l) => l.usuarioId === adminDb.id) && /apto em/.test(logs[0].descricao) && /deixou de ser apto/.test(logs[1].descricao) && logs.every((l) => l.criadoEm instanceof Date))
    const org1 = (await lerOrganizacao()).get(apto.id)!
    ok("lerOrganizacao traz os países aptos (ids e nomes)", org1.paisesAptos.join() === String(pIt.id) && org1.paisesAptosDetalhados[0]?.nome === `${MARCA}Itália`)
    const comApt = await paisesComAptidaoDeclarada()
    ok("paisesComAptidaoDeclarada: só a Itália tem regra (a Espanha ficou sem apto → sem regra)", comApt.has(pIt.id) && !comApt.has(pEs.id))
    ok("excluir o usuário não deixa aptidão órfã (CASCADE do banco)", await (async () => { const tmp = await mk("Tmp", "assistente", EXEC); await definirAptidoesPais(tmp.id, [pIt.id], adminDb.id); await prisma.usuario.delete({ where: { id: tmp.id } }); return (await prisma.aptidaoOperacionalPais.count({ where: { usuarioId: tmp.id } })) === 0 })())

    secao("BANCO — a sugestão de responsável segue o país do PROCESSO da tarefa")
    const procIt = await prisma.processo.create({ data: { nome: `${MARCA}proc-it`, paisId: pIt.id }, select: { id: true } })
    const procEs = await prisma.processo.create({ data: { nome: `${MARCA}proc-es`, paisId: pEs.id }, select: { id: true } })
    const tIt = await prisma.tarefa.create({ data: { titulo: `${MARCA}tarefa-it`, statusTarefa: "NAO_INICIADA", processoId: procIt.id } })
    const tEs = await prisma.tarefa.create({ data: { titulo: `${MARCA}tarefa-es`, statusTarefa: "NAO_INICIADA", processoId: procEs.id } })
    const tAvulsa = await prisma.tarefa.create({ data: { titulo: `${MARCA}tarefa-avulsa`, statusTarefa: "NAO_INICIADA" } })
    const paises = await paisesDasTarefas([tIt.id, tEs.id, tAvulsa.id])
    ok("o país da tarefa vem do processo (nunca copiado); tarefa avulsa = sem país", paises.get(tIt.id) === pIt.id && paises.get(tEs.id) === pEs.id && paises.get(tAvulsa.id) === null)
    const sIt2 = await sugerirResponsavelPrecisaDeVoce(tIt.id)
    ok("Itália tem apto declarado: sugere o apto (3 ativas), mesmo havendo o 'Outro' com 0", sIt2?.usuarioId === apto.id && sIt2.fallback !== true, JSON.stringify(sIt2))
    const sEs2 = await sugerirResponsavelPrecisaDeVoce(tEs.id)
    ok("Espanha SEM nenhum apto declarado: 'sem aptidão cadastrada' — fallback por menor carga, nunca o admin", sEs2?.fallback === true && sEs2.usuarioId !== adminDb.id && sEs2.usuarioId === outro.id, JSON.stringify(sEs2))
    ok("tarefa avulsa (sem país): também fallback", (await sugerirResponsavelPrecisaDeVoce(tAvulsa.id))?.fallback === true)

    secao("BANCO — r1: NUNCA atribui sem aptidão comprovada (decisão da r1 mantida)")
    const plano = await planoDaR1(new Date(), false)
    const pIt3 = plano.find((p) => p.tarefaId === tIt.id)
    const pEs3 = plano.find((p) => p.tarefaId === tEs.id)
    ok("a tarefa da Itália (apto comprovado) é atribuída ao apto", pIt3?.atribui === true && pIt3.paraId === apto.id, JSON.stringify(pIt3))
    ok("a da Espanha (sem aptidão cadastrada) NÃO é atribuída: fica em 'Precisa de você'", pEs3?.atribui === false && pEs3.semApto === true && pEs3.paraId === null, JSON.stringify(pEs3))

    secao("BANCO — elegibilidade (simulação): reprova quem não é apto no país e diz por quê")
    const sim = await simularTarefa(tIt.id)
    const aval = (id: number) => sim.avaliacoes.find((a) => a.usuarioId === id)!
    ok("o apto é elegível; o 'Outro' não, pelo critério de aptidão", aval(apto.id).elegivel === true && aval(outro.id).elegivel === false && aval(outro.id).criterios.find((c) => c.chave === "APTIDAO")?.veredito === "reprovado")
    ok("o motivo cita o país", aval(outro.id).motivos.some((m) => m.codigo === "SEM_APTIDAO" && /apto em .*Itália/.test(m.texto)), aval(outro.id).motivos.map((m) => m.texto).join(" | "))
    ok("a recomendação é o apto", sim.recomendado?.usuarioId === apto.id, JSON.stringify(sim.recomendado))
    const simEs = await simularTarefa(tEs.id)
    ok("país sem regra: o critério de aptidão 'não se aplica' (e diz que não há aptidão cadastrada)", simEs.avaliacoes.every((a) => a.criterios.find((c) => c.chave === "APTIDAO")?.veredito === "nao_aplicavel") && simEs.avaliacoes[0].criterios.find((c) => c.chave === "APTIDAO")!.detalhe.includes("sem aptidão cadastrada"))
    void definirAptidoes
  } finally {
    await limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
