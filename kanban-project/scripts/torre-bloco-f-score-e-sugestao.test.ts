// scripts/torre-bloco-f-score-e-sugestao.test.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO F (29/09/2026) — score de risco, briefing do dia, e
// a sugestão de responsável (apto → menos ativas → empate 30 d → ausente vai
// para o sucessor sugerido).
//
//   npx tsx scripts/torre-bloco-f-score-e-sugestao.test.ts
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bloco-f-score-e-sugestao.test.ts")

import { prisma } from "../lib/prisma"
import { scoreDeRisco, faixaDoScore, briefingDoDia, sugerirResponsavelPrecisaDeVoce, type ItemPrecisaDeVoceTorre } from "../lib/operacional/precisa-de-voce"
import { abrirIndisponibilidade } from "../lib/operacional/organizacao"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "TORRE_F_SUG_"

async function limpar() {
  await prisma.indisponibilidadeOperacional.deleteMany({ where: { usuario: { email: { startsWith: MARCA } } } })
  await prisma.logAuditoria.deleteMany({ where: { descricao: { contains: MARCA } } })
  await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } })
}

async function main() {
  await limpar()

  secao("SCORE — exatamente os pesos da Decisão do Passo 0, item 4")
  ok("sem dono = 3", scoreDeRisco({ semDono: true, vencida: false, acompanhamentoVencido: false, cobrancasSemRespostaMuitas: false, faseDeixada: false, divergente: false, bloqueada: false, faseApostilamentoOuRetificacao: false }) === 3)
  ok("vencida = 4", scoreDeRisco({ semDono: false, vencida: true, acompanhamentoVencido: false, cobrancasSemRespostaMuitas: false, faseDeixada: false, divergente: false, bloqueada: false, faseApostilamentoOuRetificacao: false }) === 4)
  ok("acompanhamento vencido = 2", scoreDeRisco({ semDono: false, vencida: false, acompanhamentoVencido: true, cobrancasSemRespostaMuitas: false, faseDeixada: false, divergente: false, bloqueada: false, faseApostilamentoOuRetificacao: false }) === 2)
  ok("2+ cobranças sem resposta = 2", scoreDeRisco({ semDono: false, vencida: false, acompanhamentoVencido: false, cobrancasSemRespostaMuitas: true, faseDeixada: false, divergente: false, bloqueada: false, faseApostilamentoOuRetificacao: false }) === 2)
  ok("fase deixada = 3", scoreDeRisco({ semDono: false, vencida: false, acompanhamentoVencido: false, cobrancasSemRespostaMuitas: false, faseDeixada: true, divergente: false, bloqueada: false, faseApostilamentoOuRetificacao: false }) === 3)
  ok("divergência = 3", scoreDeRisco({ semDono: false, vencida: false, acompanhamentoVencido: false, cobrancasSemRespostaMuitas: false, faseDeixada: false, divergente: true, bloqueada: false, faseApostilamentoOuRetificacao: false }) === 3)
  ok("bloqueada = 2", scoreDeRisco({ semDono: false, vencida: false, acompanhamentoVencido: false, cobrancasSemRespostaMuitas: false, faseDeixada: false, divergente: false, bloqueada: true, faseApostilamentoOuRetificacao: false }) === 2)
  ok("fase Apostilamento/Retificação = 1", scoreDeRisco({ semDono: false, vencida: false, acompanhamentoVencido: false, cobrancasSemRespostaMuitas: false, faseDeixada: false, divergente: false, bloqueada: false, faseApostilamentoOuRetificacao: true }) === 1)
  ok("tudo junto soma (sem dono + vencida + bloqueada = 3+4+2 = 9)", scoreDeRisco({ semDono: true, vencida: true, acompanhamentoVencido: false, cobrancasSemRespostaMuitas: false, faseDeixada: false, divergente: false, bloqueada: true, faseApostilamentoOuRetificacao: false }) === 9)

  secao("FAIXAS — ≥6 crítico, ≥3 atenção, senão ok")
  ok("0 → ok", faixaDoScore(0) === "OK")
  ok("2 → ok", faixaDoScore(2) === "OK")
  ok("3 → atenção", faixaDoScore(3) === "ATENCAO")
  ok("5 → atenção", faixaDoScore(5) === "ATENCAO")
  ok("6 → crítico", faixaDoScore(6) === "CRITICO")
  ok("9 → crítico", faixaDoScore(9) === "CRITICO")

  secao("BRIEFING DO DIA — texto derivado dos números reais")
  const agora = new Date("2026-09-30T10:00:00.000Z")
  ok("sem itens: nada precisa de você", /nada precisa de você/i.test(briefingDoDia([], agora)))
  const itensFicticios: ItemPrecisaDeVoceTorre[] = [
    { tipo: "SEM_DONO", score: 3, faixa: "ATENCAO", tarefaId: 1, processoId: null, familiaNome: null, titulo: "x", detalhe: "x", sugestao: null, acao1: { rotulo: "x", acao: "x" }, acao2: { rotulo: "x", acao: "x" }, link: "/", contexto: {} },
    { tipo: "ESCALADA", score: 7, faixa: "CRITICO", tarefaId: 2, processoId: null, familiaNome: null, titulo: "x", detalhe: "x", sugestao: null, acao1: { rotulo: "x", acao: "x" }, acao2: { rotulo: "x", acao: "x" }, link: "/", contexto: {} },
  ]
  const texto = briefingDoDia(itensFicticios, agora)
  ok("com itens: cita a quantidade crítica", /1 crítica/.test(texto), texto)
  ok("com itens: cita sem dono", /1 sem dono/.test(texto), texto)
  ok("com itens: cita escalada", /1 escalada/.test(texto), texto)

  secao("SUGESTÃO — apto → menos ativas → empate 30 dias")
  const leve = await prisma.usuario.create({ data: { nome: `${MARCA}Leve`, email: `${MARCA}leve@teste.com`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.iniciar_concluir": true } } })
  const pesado = await prisma.usuario.create({ data: { nome: `${MARCA}Pesado`, email: `${MARCA}pesado@teste.com`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.iniciar_concluir": true } } })
  const semPermissao = await prisma.usuario.create({ data: { nome: `${MARCA}SemPermissao`, email: `${MARCA}semperm@teste.com`, senha: "x", tipo: "assistente" } })

  const outrosUsuarios = await prisma.usuario.findMany({ where: { id: { notIn: [leve.id, pesado.id, semPermissao.id] } }, select: { id: true } })
  for (const u of outrosUsuarios) {
    await prisma.tarefa.create({ data: { titulo: `${MARCA}carga-outro-${u.id}`, responsavelId: u.id, statusTarefa: "EM_ANDAMENTO" } })
  }
  for (let i = 0; i < 3; i++) {
    await prisma.tarefa.create({ data: { titulo: `${MARCA}carga-pesado-${i}`, responsavelId: pesado.id, statusTarefa: "EM_ANDAMENTO" } })
  }
  const alvo = await prisma.tarefa.create({ data: { titulo: `${MARCA}alvo-da-sugestao`, statusTarefa: "NAO_INICIADA" } })

  const s1 = await sugerirResponsavelPrecisaDeVoce(alvo.id)
  ok("sugere o de menor carga (Leve)", s1?.usuarioId === leve.id, `got ${s1?.nome}`)
  ok("nunca sugere quem não tem permissão de executar", s1?.usuarioId !== semPermissao.id)

  secao("SUGESTÃO — ausente vai para o sucessor sugerido")
  const sucessorDoLeve = await prisma.usuario.create({ data: { nome: `${MARCA}SucessorDoLeve`, email: `${MARCA}sucessor@teste.com`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.iniciar_concluir": true } } })
  await abrirIndisponibilidade({ usuarioId: leve.id, tipo: "FERIAS", inicio: new Date(), fim: null, autorId: pesado.id, sucessorSugeridoId: sucessorDoLeve.id })

  const s2 = await sugerirResponsavelPrecisaDeVoce(alvo.id)
  ok("Leve está ausente → sugestão vira o sucessor dele", s2?.usuarioId === sucessorDoLeve.id, `got ${s2?.nome}`)
  ok("o motivo explica a substituição", /ausente/i.test(s2?.motivo ?? ""), s2?.motivo)

  await limpar()

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
