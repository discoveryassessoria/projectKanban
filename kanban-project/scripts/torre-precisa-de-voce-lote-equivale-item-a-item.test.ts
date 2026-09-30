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
  montarPrecisaDeVoce, itensPrecisaDeVoce, sugerirResponsavelPrecisaDeVoce, textoDaSugestao, briefingDoDia,
  type ItemPrecisaDeVoceTorre,
} from "../lib/operacional/precisa-de-voce"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const MARCA = "TORRE_PDV_LOTE"
const DIA = 86_400_000

/** O caminho "de sempre": a lista e, para cada item que pede sugestão, uma chamada pública à regra. */
async function itemAItem(agora: Date) {
  const brutos = await itensPrecisaDeVoce({ agora })
  const itens: ItemPrecisaDeVoceTorre[] = []
  for (const it of brutos) {
    if ((it.tipo === "FASE_DEIXADA" || it.tipo === "SEM_DONO") && it.tarefaId != null) {
      const s = await sugerirResponsavelPrecisaDeVoce(it.tarefaId, agora)
      itens.push({
        ...it, sugestao: textoDaSugestao(s),
        acao1: { ...it.acao1, rotulo: s ? `Atribuir a ${s.nome}` : it.acao1.rotulo },
        contexto: { ...it.contexto, sugeridoId: s?.usuarioId ?? null, sugeridoNome: s?.nome ?? null },
      })
    } else itens.push(it)
  }
  return {
    itens, briefing: briefingDoDia(itens, agora),
    resumo: { total: itens.length, criticos: itens.filter((i) => i.faixa === "CRITICO").length, atencao: itens.filter((i) => i.faixa === "ATENCAO").length },
  }
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

    secao("LOTE × ITEM A ITEM — o mesmo instante, o mesmo banco, o mesmo JSON")
    const agora = new Date()
    const lote = await montarPrecisaDeVoce(agora)
    const item = await itemAItem(agora)
    const tipos = [...new Set(lote.itens.map((i) => i.tipo))].sort().join(",")
    ok("o cenário produz itens que pedem sugestão E outros tipos (não é comparação vazia)", lote.itens.some((i) => i.tipo === "SEM_DONO") && lote.itens.length >= 4, `${lote.itens.length} itens: ${tipos}`)
    ok("itens idênticos, na mesma ordem", isDeepStrictEqual(lote.itens, item.itens))
    ok("briefing e resumo idênticos", lote.briefing === item.briefing && isDeepStrictEqual(lote.resumo, item.resumo))
    ok("a resposta inteira é deep-equal", isDeepStrictEqual(JSON.parse(JSON.stringify(lote)), JSON.parse(JSON.stringify(item))))
    const sd = lote.itens.find((i) => i.tipo === "SEM_DONO" && i.tarefaId === semDonoA.tarefaId)
    ok("a tarefa com unidade de trabalho e a apta cadastrada: sugestão = a Ana (apta), com a unidade no motivo", sd?.contexto.sugeridoId === ana.id && /apto a/.test(sd.sugestao ?? ""), sd?.sugestao ?? "")
    ok("o administrador não é sugerido em nenhum item", lote.itens.every((i) => i.contexto.sugeridoNome == null || !/admin/i.test(String(i.contexto.sugeridoNome))))
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
