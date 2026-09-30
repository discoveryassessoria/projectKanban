// scripts/torre-bloco-e-comentarios.test.ts
// ============================================================================
// TORRE DE CONTROLE, BLOCO E4 (29/09/2026) — comentários por tarefa e por
// família, com @menção. A menção é a "notificação" (decidida separada do
// sino em redesenho paralelo — ver src/services/comentario-tarefa.ts).
//
//   npx tsx scripts/torre-bloco-e-comentarios.test.ts
//
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-bloco-e-comentarios.test.ts")

import { prisma } from "../lib/prisma"
import {
  criarComentario, listarComentarios, mencoesNaoLidas, marcarMencaoComoLida, idsMencionados,
} from "../src/services/comentario-tarefa"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "TORRE_E4_"

async function limpar() {
  await prisma.comentarioMencao.deleteMany({ where: { usuario: { email: { startsWith: MARCA } } } })
  await prisma.comentarioTarefa.deleteMany({ where: { autor: { email: { startsWith: MARCA } } } })
  await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
  await prisma.familia.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { startsWith: MARCA } } })
}

async function main() {
  await limpar()

  secao("PARSER — idsMencionados")
  ok("extrai um id", JSON.stringify(idsMencionados("oi @[Daniela](42)")) === "[42]")
  ok("extrai vários, sem repetir", JSON.stringify(idsMencionados("@[A](1) e @[B](2) e @[A de novo](1)")) === "[1,2]")
  ok("texto sem menção → lista vazia", idsMencionados("nada aqui").length === 0)

  const autor = await prisma.usuario.create({ data: { nome: `${MARCA}Autor`, email: `${MARCA}autor@teste.com`, senha: "x", tipo: "assistente" } })
  const citada = await prisma.usuario.create({ data: { nome: `${MARCA}Citada`, email: `${MARCA}citada@teste.com`, senha: "x", tipo: "assistente" } })
  const tarefa = await prisma.tarefa.create({ data: { titulo: `${MARCA}tarefa` } })
  const familia = await prisma.familia.create({ data: { nome: `${MARCA}familia` } })

  secao("E4 · ÂNCORA — exatamente uma, nunca as duas, nunca nenhuma")
  const semAncora = await criarComentario({ autorId: autor.id, texto: "oi" })
  ok("recusa sem âncora nenhuma", semAncora.ok === false)
  const duasAncoras = await criarComentario({ tarefaId: tarefa.id, familiaId: familia.id, autorId: autor.id, texto: "oi" })
  ok("recusa com as DUAS âncoras", duasAncoras.ok === false)
  const semTexto = await criarComentario({ tarefaId: tarefa.id, autorId: autor.id, texto: "   " })
  ok("recusa texto vazio", semTexto.ok === false)

  secao("E4 · COMENTÁRIO POR TAREFA + MENÇÃO")
  const c1 = await criarComentario({
    tarefaId: tarefa.id, autorId: autor.id,
    texto: `Fulano, olha isso @[${citada.nome}](${citada.id})`,
  })
  ok("cria o comentário", c1.ok === true)
  if (c1.ok) {
    ok("guarda o texto", c1.comentario.texto.includes("olha isso"))
    ok("resolve o mencionado", c1.comentario.mencionados.length === 1 && c1.comentario.mencionados[0].usuarioId === citada.id)
  }

  const listaDaTarefa = await listarComentarios({ tarefaId: tarefa.id })
  ok("lista por tarefa devolve o comentário", listaDaTarefa.length === 1)
  ok("a menção aparece na listagem, não lida ainda", listaDaTarefa[0]?.mencionados[0]?.lidaEm == null)

  const naoLidasDaCitada = await mencoesNaoLidas(citada.id)
  ok("a citada tem 1 menção não lida", naoLidasDaCitada.length === 1)
  ok("a menção aponta para a tarefa certa", naoLidasDaCitada[0]?.tarefaId === tarefa.id)

  secao("E4 · MENÇÃO A SI MESMO NÃO GERA NOTIFICAÇÃO")
  await criarComentario({ tarefaId: tarefa.id, autorId: autor.id, texto: `Anotando pra mim @[${autor.nome}](${autor.id})` })
  const naoLidasDoAutor = await mencoesNaoLidas(autor.id)
  ok("autor mencionando a si mesmo não gera menção", naoLidasDoAutor.length === 0, `got ${naoLidasDoAutor.length}`)

  secao("E4 · MARCAR COMO LIDA — só o próprio destinatário")
  const mencaoId = naoLidasDaCitada[0]!.id
  const outroUsuario = await prisma.usuario.create({ data: { nome: `${MARCA}Outro`, email: `${MARCA}outro@teste.com`, senha: "x", tipo: "assistente" } })
  const tentativaErrada = await marcarMencaoComoLida(mencaoId, outroUsuario.id)
  ok("não marca como lida em nome de outro usuário", tentativaErrada.ok === false)
  const tentativaCorreta = await marcarMencaoComoLida(mencaoId, citada.id)
  ok("marca como lida pelo próprio destinatário", tentativaCorreta.ok === true)
  ok("depois de marcar, some das não lidas", (await mencoesNaoLidas(citada.id)).length === 0)

  secao("E4 · COMENTÁRIO POR FAMÍLIA")
  const c2 = await criarComentario({ familiaId: familia.id, autorId: autor.id, texto: "comentário da família inteira" })
  ok("cria comentário por família", c2.ok === true)
  const listaDaFamilia = await listarComentarios({ familiaId: familia.id })
  ok("lista por família devolve o comentário", listaDaFamilia.length === 1)
  const tarefaInexistente = await criarComentario({ tarefaId: 999_999_999, autorId: autor.id, texto: "x" })
  ok("recusa tarefa inexistente", tarefaInexistente.ok === false)

  secao("E4 · AUDITORIA — toda ação grava LogAuditoria (Regra 6)")
  const logs = await prisma.logAuditoria.count({ where: { acao: "COMENTARIO_CRIADO", usuarioId: autor.id } })
  ok("cada comentário criado gerou uma linha de auditoria", logs >= 3, `got ${logs}`)

  await limpar()

  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) { for (const f of falhas) console.log(`  · ${f}`); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
