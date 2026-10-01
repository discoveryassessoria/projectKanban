// scripts/torre-nova-processo-mencao.test.ts
// ============================================================================
// TORRE NOVA, FRENTE H — a @menção ENTREGA pelo sino e pelo resumo diário.
//   npx tsx scripts/torre-nova-processo-mencao.test.ts      (banco de TESTE)
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { prisma } from "../lib/prisma"
import { criarComentario, mencoesNaoLidas } from "../src/services/comentario-tarefa"
import { avisosDoSino, marcarNotificacaoComoLida, marcarTodasComoLidas, marcarMencoesDoProcessoComoLidas } from "../lib/operacional/notificacao-canonica"
import { rodarResumoDiario, resumirMencoesNaoLidas } from "../lib/operacional/avisos-sino"
import { textoDoAviso } from "../lib/operacional/aviso-texto"
import { trechoDoComentario } from "../lib/operacional/avisos-fatos"

const MARCA = "TNPM"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}`) } else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({ where: { destinatario: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } } })
  await prisma.comentarioMencao.deleteMany({ where: { usuario: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } } })
  await prisma.comentarioTarefa.deleteMany({ where: { autor: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } } })
  await prisma.logAuditoria.deleteMany({ where: { descricao: { contains: MARCA } } })
  await prisma.processo.deleteMany({ where: { id: { in: procs.map((p) => p.id) } } })
  await prisma.familia.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
}
const usuario = (nome: string, tipo: string) =>
  prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${nome.toLowerCase()}@${MARCA.toLowerCase()}.test`, senha: "x", tipo }, select: { id: true, nome: true } })
const mencoes = (dest: number, extra: Record<string, unknown> = {}) =>
  prisma.notificacaoOperacional.findMany({ where: { destinatarioId: dest, tipo: "MENCAO", ...extra }, orderBy: { id: "asc" } })

async function main() {
  exigirBancoDeTeste("prova a entrega da @menção pelo sino e pelo resumo diário")
  await limpar()

  console.log("TEXTO")
  ok("1 menção: 'Autor mencionou você em Família: “trecho”'", textoDoAviso("MENCAO", "Lombardi", { contagem: 1, resumo: { ultima: { autor: "Marco", trecho: "olha isso" } } }) === "Marco mencionou você em Lombardi: “olha isso”")
  ok("N menções", textoDoAviso("MENCAO", "Lombardi", { contagem: 3 }) === "Lombardi — 3 menções a você")
  ok("trecho tira o marcador @[Nome](id)", trechoDoComentario("oi @[Daniela](4), vê") === "oi @Daniela, vê")

  const marco = await usuario("Marco", "admin")
  const daniela = await usuario("Daniela", "assistente")
  const priscila = await usuario("Priscila", "assistente")
  const fam = await prisma.familia.create({ data: { nome: `${MARCA} Lombardi` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} proc`, familiaId: fam.id }, select: { id: true } })

  console.log("\nENTREGA NO SINO")
  const c1 = await criarComentario({ familiaId: fam.id, processoId: proc.id, autorId: marco.id, texto: `@[${daniela.nome}](${daniela.id}) pode distribuir? @[${marco.nome}](${marco.id})` })
  ok("comentário criado", c1.ok)
  const av = await mencoes(daniela.id)
  ok("a mencionada recebe UM aviso MENCAO agrupado", av.length === 1 && av[0].agrupado === true && av[0].processoId === proc.id && av[0].contagem === 1)
  ok("texto legível com autor, família e trecho", av[0]?.titulo.startsWith(`${marco.nome} mencionou você em ${MARCA} Lombardi: `) && av[0].titulo.includes("pode distribuir"), av[0]?.titulo)
  ok("assistente: o link leva à família na Operação (não à Torre, que ela não abre)", av[0]?.link === `/operacao?processo=${proc.id}&aba=fila`, av[0]?.link ?? "")
  ok("o AUTOR não recebe aviso de si mesmo", (await mencoes(marco.id)).length === 0)
  ok("o aviso aparece no sino dela", (await avisosDoSino(prisma, daniela.id)).naoLidos.some((a) => a.tipo === "MENCAO"))

  console.log("\nADMIN × LINK, SOMA E IDEMPOTÊNCIA")
  await criarComentario({ familiaId: fam.id, processoId: proc.id, autorId: daniela.id, texto: `@[${marco.nome}](${marco.id}) feito` })
  const avM = await mencoes(marco.id)
  ok("admin: link /torre/processo/<id>#comentarios", avM[0]?.link === `/torre/processo/${proc.id}#comentarios`, avM[0]?.link ?? "")
  const c3 = await criarComentario({ familiaId: fam.id, processoId: proc.id, autorId: marco.id, texto: `@[${daniela.nome}](${daniela.id}) de novo` })
  const av2 = await mencoes(daniela.id)
  ok("segunda menção SOMA no mesmo aviso aberto (2 menções)", av2.length === 1 && av2[0].contagem === 2 && av2[0].titulo.includes("2 menções"), av2[0]?.titulo)
  // replay da mesma menção (mesmo comentário) não soma
  const { avisarMencao } = await import("../lib/operacional/avisos-fatos")
  if (c3.ok) await avisarMencao(prisma, { destinatarioId: daniela.id, destinatarioEhAdmin: false, comentarioId: c3.comentario.id, autorId: marco.id, autorNome: marco.nome, texto: "x", processoId: proc.id, familiaNome: "F" })
  ok("replay do MESMO comentário é idempotente", (await mencoes(daniela.id))[0].contagem === 2)

  console.log("\nINVÁLIDOS")
  const antes = await prisma.notificacaoOperacional.count({ where: { tipo: "MENCAO" } })
  const cInex = await criarComentario({ familiaId: fam.id, processoId: proc.id, autorId: marco.id, texto: "@[Fantasma](99999999) oi" })
  ok("menção a usuário inexistente é ignorada (comentário ok, sem aviso)", cInex.ok && (await prisma.notificacaoOperacional.count({ where: { tipo: "MENCAO" } })) === antes)
  const sem = await criarComentario({ familiaId: null, tarefaId: null, autorId: marco.id, texto: `@[${daniela.nome}](${daniela.id}) oi` })
  ok("processo sem família: sem âncora → recusa com mensagem (rota devolve 422)", !sem.ok && /EXATAMENTE uma/.test(sem.erro))
  ok("e NÃO criou família", (await prisma.familia.count({ where: { nome: { startsWith: MARCA } } })) === 1)
  const outro = await prisma.processo.create({ data: { nome: `${MARCA} outro` }, select: { id: true } })
  const cFora = await criarComentario({ familiaId: fam.id, processoId: outro.id, autorId: marco.id, texto: `@[${priscila.nome}](${priscila.id}) oi` })
  ok("processoId que não é da família é ignorado: usa o processo da família", cFora.ok && (await mencoes(priscila.id))[0]?.processoId === proc.id)

  console.log("\nRESUMO DIÁRIO")
  await prisma.notificacaoOperacional.deleteMany({ where: { tipo: "MENCAO", destinatarioId: daniela.id } })
  const ens = await resumirMencoesNaoLidas({ ensaio: true })
  ok("ensaio só conta (não escreve)", ens.mencoes >= 2 && (await mencoes(daniela.id)).length === 0)
  const rd = await rodarResumoDiario({ agora: new Date() })
  ok("o resumo reabre o aviso das menções NÃO lidas", rd.mencoes.mencoes >= 2 && (await mencoes(daniela.id, { lidaEm: null })).length === 1)
  const n1 = (await mencoes(daniela.id))[0]
  await resumirMencoesNaoLidas()
  const depois = await mencoes(daniela.id)
  ok("rodar de novo não renotifica (mesmo aviso, mesma contagem)", depois.length === 1 && depois[0].id === n1.id && depois[0].contagem === n1.contagem)

  console.log("\nLEITURA")
  ok("há 2 menções não lidas pela API de menções", (await mencoesNaoLidas(daniela.id)).length === 2)
  const r = await marcarNotificacaoComoLida(prisma, { notificacaoId: n1.id, usuarioId: daniela.id })
  ok("abrir o aviso do sino marca lida", r.ok && (await mencoesNaoLidas(daniela.id)).length === 0)
  await rodarResumoDiario({ agora: new Date() })
  ok("lida não volta no resumo", (await mencoes(daniela.id, { lidaEm: null })).length === 0)
  const alheio = await marcarNotificacaoComoLida(prisma, { notificacaoId: n1.id, usuarioId: marco.id })
  ok("só o destinatário lê", !alheio.ok)

  // pela página do processo
  await criarComentario({ familiaId: fam.id, processoId: proc.id, autorId: marco.id, texto: `@[${daniela.nome}](${daniela.id}) olha` })
  ok("nova menção: novo aviso aberto", (await mencoes(daniela.id, { lidaEm: null })).length === 1)
  const pg = await marcarMencoesDoProcessoComoLidas(prisma, { usuarioId: daniela.id, processoId: proc.id })
  ok("abrir a página do processo (#comentarios) lê as menções E tira o aviso do sino", pg.quantidade === 1 && (await mencoes(daniela.id, { lidaEm: null })).length === 0)
  await criarComentario({ familiaId: fam.id, processoId: proc.id, autorId: marco.id, texto: `@[${daniela.nome}](${daniela.id}) e agora` })
  await marcarTodasComoLidas(prisma, daniela.id)
  ok("'marcar todas' também lê as menções", (await mencoesNaoLidas(daniela.id)).length === 0)

  console.log("\nHISTÓRICO")
  const log = await prisma.logAuditoria.findFirst({ where: { acao: "COMENTARIO_CRIADO", entidade: "Familia", entidadeId: fam.id }, orderBy: { id: "asc" } })
  ok("a menção fica no histórico da família (LogAuditoria com mencionados e processoId)", !!log && (log.detalhes as { processoId?: number })?.processoId === proc.id && log.descricao.includes("menções"))

  await limpar()
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await limpar().catch(() => null); process.exit(1) })
