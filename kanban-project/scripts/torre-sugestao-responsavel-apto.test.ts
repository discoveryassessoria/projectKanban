// scripts/torre-sugestao-responsavel-apto.test.ts
// ============================================================================
// TORRE — A SUGESTÃO DE RESPONSÁVEL SÓ APONTA QUEM É APTO (30/09/2026).
//
// Achado real: depois de encerradas as tarefas "Atribuir tarefas", a sugestão virou "Sugiro Marco Rovatti:
// 0 ativa(s)" — o administrador aparecia só por ter carga zero (a permissão dele vem do tipo, não de executar
// aquele trabalho). Regra agora:
//   • há aptos (aptidão da unidade de trabalho ou equipe exigida existente) → o apto de MENOR carga;
//   • ninguém tem aptidão cadastrada → FALLBACK explícito ("Ninguém com aptidão cadastrada para esta tarefa;
//     sugiro X por menor carga"), nunca administrador; sem quem execute → sem sugestão;
//   • ausente vai para o sucessor sugerido — se o sucessor também for apto e estiver disponível.
//
//   npx tsx scripts/torre-sugestao-responsavel-apto.test.ts   (banco de teste)
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-sugestao-responsavel-apto.test.ts")

import { prisma } from "../lib/prisma"
import {
  escolherResponsavel, textoDaSugestao, sugerirResponsavelPrecisaDeVoce, comSugestoes,
  type ContextoDeSugestao, type ItemPrecisaDeVoceTorre,
} from "../lib/operacional/precisa-de-voce"
import { definirAptidoes, abrirIndisponibilidade } from "../lib/operacional/organizacao"

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
const org = (id: number, nome: string, o: { aptidoes?: number[]; ausenteCom?: number | null } = {}) => ({
  usuarioId: id, nome, equipes: [], aptidoes: o.aptidoes ?? [], aptidoesDetalhadas: [],
  indisponivelPor: o.ausenteCom === undefined ? null
    : { id: 1, tipo: "FERIAS" as const, inicio: "", fim: null, motivo: null, sucessorSugerido: o.ausenteCom == null ? null : { usuarioId: o.ausenteCom, nome: `U${o.ausenteCom}` } },
  indisponibilidades: [], limiteExecutaveis: null, observacaoCapacidade: null,
})
function contexto(args: {
  usuarios: U[]; ativas?: Record<number, number>; aptidoes?: Record<number, number[]>; ausentes?: Record<number, number | null>; equipes?: Record<string, number[]>
}): ContextoDeSugestao {
  const organizacao = new Map(args.usuarios.map((u) => [u.id, org(u.id, u.nome, { aptidoes: args.aptidoes?.[u.id], ausenteCom: args.ausentes && u.id in args.ausentes ? args.ausentes[u.id] : undefined })]))
  return {
    organizacao: organizacao as never, usuarios: args.usuarios,
    ativasPorUsuario: new Map(Object.entries(args.ativas ?? {}).map(([k, v]) => [Number(k), v])),
    atribuicoes30dPorUsuario: new Map(),
    unidadesComAptidao: new Set([...organizacao.values()].flatMap((o) => o.aptidoes)),
    rotulos: new Map([[7, { perfilOperacionalId: 7, code: "ES", nome: "Espanha", familia: null }]]) as never,
    equipes: new Map(Object.entries(args.equipes ?? {}).map(([k, v]) => [k, new Set(v)])),
  }
}
const alvo = (unidadeOperacionalId: number | null, equipeExigida: string | null = null) => ({ unidadeOperacionalId, equipeExigida })

async function main() {
  secao("APTO EXISTE → sugere o apto de MENOR carga (o administrador com carga zero NÃO entra)")
  const admin = usuario(1, "Marco Admin", "admin", null)
  const ctxApto = contexto({
    usuarios: [admin, usuario(2, "Dani"), usuario(3, "Beto"), usuario(4, "Cris")],
    ativas: { 2: 5, 3: 2, 4: 0 }, aptidoes: { 2: [7], 3: [7] },
  })
  const sApto = escolherResponsavel(ctxApto, alvo(7))
  ok("o apto de menor carga (Beto, 2) — não a Cris (0, sem aptidão) nem o admin (0)", sApto?.usuarioId === 3, JSON.stringify(sApto))
  ok("não é fallback e o motivo cita a unidade", sApto?.fallback !== true && /apto a Espanha/.test(sApto?.motivo ?? ""), sApto?.motivo)
  ok("texto: 'Sugiro Beto: 2 ativa(s), apto a Espanha'", textoDaSugestao(sApto) === "Sugiro Beto: 2 ativa(s), apto a Espanha", textoDaSugestao(sApto))
  const soAdminApto = contexto({ usuarios: [admin, usuario(2, "Dani")], aptidoes: { 1: [7] } })
  ok("administrador que FOI declarado apto à unidade pode ser sugerido (aptidão cadastrada é aptidão)", escolherResponsavel(soAdminApto, alvo(7))?.usuarioId === 1)
  const nenhumApto = contexto({ usuarios: [admin, usuario(2, "Dani")], aptidoes: { 2: [7] }, ativas: {} })
  ok("a unidade tem regra e o apto é o único → nunca cai em outro (admin fora)", escolherResponsavel(nenhumApto, alvo(7))?.usuarioId === 2)
  const aptoSemPermissao = contexto({ usuarios: [admin, usuario(2, "Dani", "assistente", null)], aptidoes: { 2: [7] } })
  ok("apto sem permissão de executar → sem sugestão (nunca o admin no lugar)", escolherResponsavel(aptoSemPermissao, alvo(7)) === null)

  secao("NINGUÉM APTO (nenhuma aptidão cadastrada) → FALLBACK explícito, jamais o administrador")
  const ctxFb = contexto({ usuarios: [admin, usuario(2, "Dani"), usuario(3, "Beto")], ativas: { 2: 4, 3: 1 } })
  for (const [rot, a] of [["unidade sem ninguém declarado apto", alvo(7)], ["tarefa sem unidade de trabalho", alvo(null)]] as const) {
    const s = escolherResponsavel(ctxFb, a)
    ok(`${rot}: sugere o de menor carga entre quem executa (Beto), marcado como fallback`, s?.usuarioId === 3 && s.fallback === true, JSON.stringify(s))
    ok(`${rot}: o administrador (carga 0) não é sugerido`, s?.usuarioId !== 1)
    ok(`${rot}: o texto diz que é fallback`, textoDaSugestao(s) === "Ninguém com aptidão cadastrada para esta tarefa; sugiro Beto por menor carga (1 ativa(s)).", textoDaSugestao(s))
  }
  const soAdmin = contexto({ usuarios: [admin] })
  ok("só há o administrador → sem sugestão (nem fallback é seguro)", escolherResponsavel(soAdmin, alvo(null)) === null)
  ok("sem sugestão, o texto é o de sempre", textoDaSugestao(null) === "Nenhum candidato apto e disponível encontrado.")

  secao("EQUIPE EXIGIDA (existente no cadastro) define quem é apto")
  const ctxEq = contexto({ usuarios: [admin, usuario(2, "Dani"), usuario(3, "Beto"), usuario(4, "Cris")], ativas: { 2: 3, 3: 1, 4: 0 }, equipes: { equipe_documental: [2, 3] } })
  const sEq = escolherResponsavel(ctxEq, alvo(null, "equipe_documental"))
  ok("só membros da equipe: Beto (1), não a Cris (0) nem o admin", sEq?.usuarioId === 3 && sEq.fallback !== true && /equipe equipe_documental/.test(sEq.motivo), JSON.stringify(sEq))
  const sEqInexistente = escolherResponsavel(ctxEq, alvo(null, "equipe_que_nao_existe"))
  ok("equipe que não existe no cadastro não é regra → cai no fallback (Cris, 0)", sEqInexistente?.usuarioId === 4 && sEqInexistente.fallback === true)

  secao("AUSENTE → SUCESSOR, mas só se o sucessor também for apto e estiver disponível")
  const ctxAus = contexto({ usuarios: [usuario(2, "Dani"), usuario(3, "Beto"), usuario(4, "Cris")], ativas: { 2: 0, 3: 2, 4: 5 }, aptidoes: { 2: [7], 3: [7] }, ausentes: { 2: 3 } })
  ok("Dani (apta, ausente) → sucessor Beto (apto)", escolherResponsavel(ctxAus, alvo(7))?.usuarioId === 3)
  const ctxAusNaoApto = contexto({ usuarios: [usuario(2, "Dani"), usuario(3, "Beto"), usuario(4, "Cris")], ativas: { 2: 0, 3: 2, 4: 5 }, aptidoes: { 2: [7], 3: [7] }, ausentes: { 2: 4 } })
  const sNaoApto = escolherResponsavel(ctxAusNaoApto, alvo(7))
  ok("sucessor NÃO apto (Cris) é ignorado: segue o ranking → Beto", sNaoApto?.usuarioId === 3, JSON.stringify(sNaoApto))
  const ctxSucAusente = contexto({ usuarios: [usuario(2, "Dani"), usuario(3, "Beto")], ativas: { 2: 0, 3: 2 }, aptidoes: { 2: [7], 3: [7] }, ausentes: { 2: 3, 3: null } })
  ok("sucessor também ausente → não é sugerido (ninguém disponível → sem sugestão)", escolherResponsavel(ctxSucAusente, alvo(7)) === null)

  secao("LOTE: as ativas já decididas balanceiam o ranking")
  const ctxLote = contexto({ usuarios: [usuario(2, "Dani"), usuario(3, "Beto")], ativas: { 2: 0, 3: 0 }, aptidoes: { 2: [7], 3: [7] } })
  ok("com Dani já com 1 decidida, o próximo vai para o Beto", escolherResponsavel(ctxLote, alvo(7), new Map([[2, 1]]))?.usuarioId === 3)

  // ─── DO BANCO: aptidão real por unidade de trabalho (cadeia canônica) e o texto de 'comSugestoes' ──────
  secao("BANCO — cadeia canônica: tarefa → documento → tipo → unidade; comSugestoes escreve o texto que a tela mostra")
  const MARCA = "TORRE_SUG_APTO_"
  const limpar = async () => {
    await prisma.indisponibilidadeOperacional.deleteMany({ where: { usuario: { email: { startsWith: MARCA } } } })
    await prisma.aptidaoOperacional.deleteMany({ where: { perfilOperacional: { code: { startsWith: MARCA } } } })
    await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
    const docs = await prisma.documento.findMany({ where: { descricao: { startsWith: MARCA } }, select: { id: true, pessoaId: true } })
    await prisma.documento.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } })
    await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: MARCA } } })
    await prisma.perfilOperacionalDocumento.deleteMany({ where: { code: { startsWith: MARCA } } })
    const arvores = [...new Set((await prisma.pessoa.findMany({ where: { id: { in: docs.map((d) => d.pessoaId) } }, select: { arvoreId: true } })).map((p) => p.arvoreId).filter((i): i is number => i != null))]
    await prisma.pessoa.deleteMany({ where: { id: { in: docs.map((d) => d.pessoaId) } } })
    await prisma.arvore.deleteMany({ where: { id: { in: arvores } } })
    await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } })
  }
  await limpar()
  try {
    const mk = (nome: string, tipo: string, perms: Record<string, boolean> | null) =>
      prisma.usuario.create({ data: { nome: `${MARCA}${nome}`, email: `${MARCA}${nome}@t.com`, senha: "x", tipo, ...(perms ? { permissoesCustom: perms } : {}) } })
    const adminDb = await mk("Admin", "admin", null)
    const apto = await mk("Apto", "assistente", EXEC)
    const outro = await mk("Outro", "assistente", EXEC)
    // Todo o resto do banco de teste ganha carga alta: só os usuários desta cena disputam o ranking.
    const demais = await prisma.usuario.findMany({ where: { id: { notIn: [adminDb.id, apto.id, outro.id] } }, select: { id: true } })
    for (const u of demais) for (let i = 0; i < 6; i++) await prisma.tarefa.create({ data: { titulo: `${MARCA}carga-${u.id}-${i}`, responsavelId: u.id, statusTarefa: "EM_ANDAMENTO" } })
    for (let i = 0; i < 3; i++) await prisma.tarefa.create({ data: { titulo: `${MARCA}carga-apto-${i}`, responsavelId: apto.id, statusTarefa: "EM_ANDAMENTO" } })

    const perfil = await prisma.perfilOperacionalDocumento.create({ data: { code: `${MARCA}PERFIL`, name: `${MARCA}Espanha` } })
    const tipoDoc = await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}TIPO`, name: `${MARCA}Certidão`, perfilOperacionalId: perfil.id } })
    const arvore = await prisma.arvore.create({ data: { nome: `${MARCA}arvore` }, select: { id: true } })
    const pessoa = await prisma.pessoa.create({ data: { arvoreId: arvore.id, nome: `${MARCA}Pessoa`, sobrenome: "Teste", linhaReta: true, requerente: "nao" }, select: { id: true } })
    const doc = await prisma.documento.create({ data: { pessoaId: pessoa.id, descricao: `${MARCA}doc`, documentTypeId: tipoDoc.id }, select: { id: true } })
    const comUnidade = await prisma.tarefa.create({ data: { titulo: `${MARCA}com-unidade`, statusTarefa: "NAO_INICIADA", documentoId: doc.id } })
    const semUnidade = await prisma.tarefa.create({ data: { titulo: `${MARCA}sem-unidade`, statusTarefa: "NAO_INICIADA" } })

    // (a) ninguém apto à unidade → fallback: o de menor carga entre quem executa; o admin (carga 0) fora.
    const fb = await sugerirResponsavelPrecisaDeVoce(comUnidade.id)
    ok("nenhuma aptidão cadastrada: o administrador (carga 0) NÃO é sugerido", fb?.usuarioId !== adminDb.id, JSON.stringify(fb))
    ok("…e a sugestão é o fallback por menor carga (Outro, 0 ativas)", fb?.usuarioId === outro.id && fb.fallback === true)

    // (b) alguém declarado apto → só ele, mesmo com MAIS carga que o Outro.
    await definirAptidoes(apto.id, [perfil.id])
    const sApto2 = await sugerirResponsavelPrecisaDeVoce(comUnidade.id)
    ok("com aptidão cadastrada, o apto (3 ativas) vence quem tem 0 e não é apto", sApto2?.usuarioId === apto.id && sApto2.fallback !== true, JSON.stringify(sApto2))
    ok("a tarefa SEM unidade continua sem regra de aptidão → fallback (o apto de OUTRA unidade não vira apto a tudo)", (await sugerirResponsavelPrecisaDeVoce(semUnidade.id))?.fallback === true)

    // (c) o texto que a lista mostra, montado por comSugestoes (uma leitura para a lista toda).
    const item = (t: number): ItemPrecisaDeVoceTorre => ({
      tipo: "SEM_DONO", score: 3, faixa: "ATENCAO", tarefaId: t, processoId: null, familiaNome: null, titulo: "x", detalhe: "x", sugestao: null,
      acao1: { rotulo: "Atribuir a {sugerido}", acao: "ATRIBUIR_SUGERIDO" }, acao2: { rotulo: "x", acao: "x" }, link: "/", contexto: { tarefaId: t },
    })
    const lista = await comSugestoes([item(comUnidade.id), item(semUnidade.id)])
    ok("comSugestoes: apto → 'Sugiro <apto>: … apto a <unidade>'", new RegExp(`^Sugiro ${MARCA}Apto: 3 ativa\\(s\\), apto a ${MARCA}Espanha$`).test(lista[0].sugestao ?? ""), lista[0].sugestao ?? "")
    ok("comSugestoes: sem aptidão → mensagem de fallback explícita", /^Ninguém com aptidão cadastrada para esta tarefa; sugiro .+ por menor carga \(\d+ ativa\(s\)\)\.$/.test(lista[1].sugestao ?? ""), lista[1].sugestao ?? "")
    ok("comSugestoes iguala a sugestão por item (mesma regra, uma leitura só)", lista[0].contexto.sugeridoId === sApto2?.usuarioId && lista[1].contexto.sugeridoId === (await sugerirResponsavelPrecisaDeVoce(semUnidade.id))?.usuarioId)

    // (d) ausente com sucessor NÃO apto: o sucessor é ignorado.
    await abrirIndisponibilidade({ usuarioId: apto.id, tipo: "FERIAS", inicio: new Date(Date.now() - 1000), fim: null, autorId: adminDb.id, sucessorSugeridoId: outro.id })
    const sAus = await sugerirResponsavelPrecisaDeVoce(comUnidade.id)
    ok("o único apto está ausente e o sucessor (Outro) não é apto à unidade → sem sugestão, nunca um não apto", sAus === null, JSON.stringify(sAus))
  } finally {
    await limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
