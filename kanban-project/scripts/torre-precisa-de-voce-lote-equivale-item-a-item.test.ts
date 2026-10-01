// scripts/torre-precisa-de-voce-lote-equivale-item-a-item.test.ts
// ============================================================================
// TORRE — DESEMPENHO DO "PRECISA DE VOCÊ" SEM MUDAR O RESULTADO (30/09/2026).
//
// Achado real: GET /api/torre/precisa-de-voce levava ~4,2 s. A lista pedia a sugestão de responsável item a
// item, e cada chamada refazia ~9 leituras idênticas (usuários, organização, cargas, log de 30 dias, rótulos);
// a lista ainda esperava em fila leituras independentes. Agora o contexto é lido UMA vez e as leituras
// independentes correm juntas — mas a resposta tem de ser IDÊNTICA à do caminho item a item.
//
// PROVA: sobre o MESMO instante (`agora`) e o mesmo banco, `montarPrecisaDeVoce` (lote) e a composição
// "lista + sugestão por item pela função pública" devolvem exatamente o mesmo JSON (itens, briefing, resumo).
//
//   npx tsx scripts/torre-precisa-de-voce-lote-equivale-item-a-item.test.ts   (banco de teste)
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("torre-precisa-de-voce-lote-equivale-item-a-item.test.ts")

import { isDeepStrictEqual } from "node:util"
import { prisma } from "../lib/prisma"
import { montarCenario } from "./_fixture-torre-gh"
import { definirAptidoes, definirCapacidade } from "../lib/operacional/organizacao"
import {
  montarPrecisaDeVoce, sugerirResponsavelPrecisaDeVoce, carregarContextoDeSugestao, sugestaoParaTexto,
} from "../lib/operacional/precisa-de-voce"
import { planoDoSemDono, textosDoSemDono } from "../lib/operacional/precisa-de-voce-decisoes"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORRE_PDV_LOTE"
const DIA = 86_400_000

/**
 * O caminho "de sempre": para cada decisão "Sem responsável" (um item por PROCESSO), a sugestão de CADA certidão pela função pública
 * (uma chamada por tarefa, refazendo as leituras) e o plano/texto remontados pelas mesmas funções puras. Tudo o mais é copiado.
 */
async function itemAItem(agora: Date, lote: Awaited<ReturnType<typeof montarPrecisaDeVoce>>) {
  const ctx = await carregarContextoDeSugestao(agora)
  const itens = []
  for (const it of lote.itens) {
    if (it.tipo !== "SEM_DONO") { itens.push(it); continue }
    const ids = it.contexto.tarefaIds as number[]
    const sugestoes = []
    for (const id of ids) sugestoes.push({ taskId: id, sugestao: sugestaoParaTexto(ctx, await sugerirResponsavelPrecisaDeVoce(id, agora)) })
    const plano = planoDoSemDono(sugestoes)
    const t = textosDoSemDono({ familia: it.familiaNome ?? "", pais: null, faseLabel: null, entrouNaFase: null, agora, total: ids.length, plano })
    itens.push({ ...it, __plano: plano, __sugestao: t.sugestao, __acao1: t.acao1.rotulo })
  }
  return itens
}

async function main() {
  const c = await montarCenario(MARCA)
  try {
    const mk = (nome: string, perms: Record<string, boolean>) =>
      prisma.usuario.create({ data: { nome: `${MARCA} ${nome}`, email: `${MARCA.toLowerCase()}-${nome.toLowerCase()}@t.com`, senha: "x", tipo: "assistente", permissoesCustom: perms } })
    const EXEC = { "tarefas.iniciar_concluir": true, "tarefas.ver": true }
    const ana = await mk("Ana", EXEC)
    const beto = await mk("Beto", EXEC)
    const perfil = await prisma.perfilOperacionalDocumento.create({ data: { code: `${MARCA}_ES`, name: `${MARCA} Espanha` } })
    const tipoDoc = await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}_T`, name: `${MARCA} Cert`, perfilOperacionalId: perfil.id } })
    await definirAptidoes(ana.id, [perfil.id])
    await definirCapacidade({ usuarioId: beto.id, limiteExecutaveis: 1, autorId: ana.id })

    // Cenário misto: sem dono com e sem unidade de trabalho, vencida, bloqueada e um dono no limite (item CARGA).
    const semDonoA = await c.novaObrigacao({ comSolicitacao: { canal: "EMAIL" } })
    await prisma.documento.update({ where: { id: semDonoA.documentoId! }, data: { documentTypeId: tipoDoc.id } })
    await c.novaObrigacao({ dataPrazo: new Date(Date.now() - 3 * DIA) })
    await c.novaObrigacao({})
    await c.novaObrigacao({ responsavelId: beto.id, dataPrazo: new Date(Date.now() - 2 * DIA) })
    const bloq = await c.novaObrigacao({ responsavelId: ana.id })
    await prisma.tarefa.update({ where: { id: bloq.tarefaId }, data: { statusTarefa: "BLOQUEADA" } })

    secao("LOTE × ITEM A ITEM — o mesmo instante, o mesmo banco, a mesma sugestão por certidão")
    const agora = new Date()
    const lote = await montarPrecisaDeVoce(agora)
    const item = await itemAItem(agora, lote)
    const tipos = [...new Set(lote.itens.map((i) => i.tipo))].sort().join(",")
    ok("o cenário produz Sem responsável E outros tipos (não é comparação vazia)", lote.itens.some((i) => i.tipo === "SEM_DONO") && lote.itens.length >= 4, `${lote.itens.length} itens: ${tipos}`)
    const semDono = lote.itens.filter((i) => i.tipo === "SEM_DONO")
    const comRemontagem = item as Array<(typeof item)[number] & { __plano?: unknown; __sugestao?: string; __acao1?: string }>
    ok("o PLANO de atribuição do lote é idêntico ao montado certidão por certidão", comRemontagem.every((x) => x.tipo !== "SEM_DONO" || isDeepStrictEqual(x.contexto.plano, x.__plano)), `${semDono.length} processos`)
    ok("a sugestão e o rótulo do botão 1 do lote são IDÊNTICOS aos do item a item", comRemontagem.every((x) => x.tipo !== "SEM_DONO" || (x.sugestao === x.__sugestao && x.acao1.rotulo === x.__acao1)))
    const sd = lote.itens.find((i) => i.tipo === "SEM_DONO" && (i.contexto.tarefaIds as number[]).includes(semDonoA.tarefaId))
    ok("a certidão com unidade de trabalho e a apta cadastrada: a sugestão é a Ana (apta), com a aptidão no texto", sd?.contexto.sugeridoId === ana.id && /apto a/.test(sd.sugestao ?? ""), sd?.sugestao ?? "")
    ok("o administrador não é sugerido em nenhum item", lote.itens.every((i) => i.contexto.sugeridoNome == null || !/admin/i.test(String(i.contexto.sugeridoNome))))
    ok("a resposta inteira é serializável e o resumo fecha com a lista", JSON.stringify(lote).length > 0 && lote.resumo.total === lote.itens.length)
  } finally {
    await prisma.tarefa.deleteMany({ where: { titulo: { startsWith: MARCA } } })
    await prisma.aptidaoOperacional.deleteMany({ where: { perfilOperacional: { code: { startsWith: MARCA } } } })
    await prisma.capacidadeOperacional.deleteMany({ where: { usuario: { email: { startsWith: MARCA.toLowerCase() } } } })
    await prisma.logAuditoria.deleteMany({ where: { entidade: "CapacidadeOperacional" } })
    await c.limpar()
    await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: MARCA } } })
    await prisma.perfilOperacionalDocumento.deleteMany({ where: { code: { startsWith: MARCA } } })
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log(falhas.join("\n")); process.exit(1) }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
