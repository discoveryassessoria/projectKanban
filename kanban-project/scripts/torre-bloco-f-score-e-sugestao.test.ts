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
import { scoreDeRisco, faixaDoScore, sugerirResponsavelPrecisaDeVoce, type ItemPrecisaDeVoceTorre } from "../lib/operacional/precisa-de-voce"
import { briefingDoDia } from "../lib/operacional/precisa-de-voce-decisoes"
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
  await prisma.aptidaoOperacional.deleteMany({ where: { perfilOperacional: { code: { startsWith: MARCA } } } })
  await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
  const docs = await prisma.documento.findMany({ where: { descricao: { startsWith: MARCA } }, select: { id: true, pessoaId: true } })
  await prisma.documento.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.perfilOperacionalDocumento.deleteMany({ where: { code: { startsWith: MARCA } } })
  const arvoreIds = [...new Set((await prisma.pessoa.findMany({ where: { id: { in: docs.map((d) => d.pessoaId) } }, select: { arvoreId: true } })).map((p) => p.arvoreId).filter((id): id is number => id != null))]
  await prisma.pessoa.deleteMany({ where: { id: { in: docs.map((d) => d.pessoaId) } } })
  await prisma.arvore.deleteMany({ where: { id: { in: arvoreIds } } })
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
  ok("com itens: cita quantas decisões esperam a pessoa", /2 decisões esperam você/.test(texto), texto)
  ok("com itens: cita Sem responsável (vocabulário oficial — nunca 'sem dono')", /1 processo com certidões sem responsável/.test(texto) && !/sem dono/i.test(texto), texto)
  ok("com itens: cita escalada", /1 cobrança escalada sem resposta/.test(texto), texto)
  const comNome = briefingDoDia(itensFicticios, agora, { nome: "Marco Rovatti", ativos: 500, noRitmo: 453, fechadasOntem: 38, protocoladosOntem: 6, vencemHoje: 38 })
  ok("com os números do dia: 'Bom dia, Marco. 500 processos ativos, 453 no ritmo. Ontem a equipe fechou 38 certidões e 6 processos foram protocolados. Hoje vencem 38 prazos.'",
    /^Bom dia, Marco\. 500 processos ativos, 453 no ritmo\. Ontem a equipe fechou 38 certidões e 6 processos foram protocolados\. Hoje vencem 38 prazos\. 2 decisões esperam você: /.test(comNome), comNome)
  ok("sem os números do dia, a frase correspondente simplesmente não aparece (nada inventado)", !/Ontem|processos ativos|Hoje vencem/.test(texto), texto)

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

  secao("SUGESTÃO — o texto cita a UNIDADE quando ela é regra (\"apto a Espanha\", achado real 30/09)")
  const perfil = await prisma.perfilOperacionalDocumento.create({ data: { code: `${MARCA}PERFIL`, name: `${MARCA}Espanha` } })
  const tipoDoc = await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}TIPO`, name: `${MARCA}Certidão`, perfilOperacionalId: perfil.id } })
  const arvore = await prisma.arvore.create({ data: { nome: `${MARCA}arvore` }, select: { id: true } })
  const pessoa = await prisma.pessoa.create({ data: { arvoreId: arvore.id, nome: `${MARCA}Pessoa`, sobrenome: "Teste", linhaReta: true, requerente: "nao" }, select: { id: true } })
  const doc = await prisma.documento.create({ data: { pessoaId: pessoa.id, descricao: `${MARCA}doc`, documentTypeId: tipoDoc.id }, select: { id: true } })
  const tarefaComUnidade = await prisma.tarefa.create({ data: { titulo: `${MARCA}com-unidade`, statusTarefa: "NAO_INICIADA", documentoId: doc.id } })

  const aptoUnico = await prisma.usuario.create({ data: { nome: `${MARCA}AptoUnico`, email: `${MARCA}aptounico@teste.com`, senha: "x", tipo: "assistente", permissoesCustom: { "tarefas.iniciar_concluir": true } } })
  await prisma.aptidaoOperacional.create({ data: { usuarioId: aptoUnico.id, perfilOperacionalId: perfil.id } })

  const s3 = await sugerirResponsavelPrecisaDeVoce(tarefaComUnidade.id)
  ok("sugere o único apto à unidade", s3?.usuarioId === aptoUnico.id, `got ${s3?.nome}`)
  ok('o motivo cita a unidade ("apto a <nome>"), nunca só "apto"', new RegExp(`apto a ${MARCA}Espanha`).test(s3?.motivo ?? ""), s3?.motivo)

  secao("BRIEFING — saudação pelo relógio de São Paulo, nunca o do servidor (achado real 30/09)")
  // 29/09 02:00 UTC = 28/09 23:00 em SP (America/Sao_Paulo = UTC-3, fixo) → noite.
  ok("madrugada em SP → Boa noite", /^Boa noite/.test(briefingDoDia([], new Date("2026-09-29T02:00:00.000Z"))))
  // 10:00 UTC = 07:00 em SP → manhã.
  ok("07h em SP → Bom dia", /^Bom dia/.test(briefingDoDia([], new Date("2026-09-29T10:00:00.000Z"))))
  // 16:00 UTC = 13:00 em SP → tarde.
  ok("13h em SP → Boa tarde", /^Boa tarde/.test(briefingDoDia([], new Date("2026-09-29T16:00:00.000Z"))))
  // 23:40 UTC = 20:40 em SP → noite (o caso real que disparou a correção).
  ok("20h40 em SP → Boa noite (nunca Bom dia por rodar em UTC)", /^Boa noite/.test(briefingDoDia([], new Date("2026-09-29T23:40:00.000Z"))))

  await limpar()

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
