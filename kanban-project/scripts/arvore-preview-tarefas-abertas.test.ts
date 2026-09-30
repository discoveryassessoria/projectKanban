// scripts/arvore-preview-tarefas-abertas.test.ts
// ============================================================================
// PREVIEW DE IMPACTO (2.5) — "Isso vai cancelar: …" ANTES de salvar.
//
// Prova, com o motor REAL em banco de teste:
//   1. desmarcar casado / sair da linha reta / desfazer a união / remover o cônjuge
//      LISTA a tarefa aberta (título, pessoa, responsável) e o Documento que passa
//      a NAO_EXIGIDO;
//   2. tarefa JÁ INICIADA aparece como "DECISAO" (não é cancelada sozinha);
//   3. a simulação NÃO GRAVA NADA (fotografia das quatro camadas + auditoria igual);
//   4. a UI: o modal "Isso vai cancelar … Confirmar?" existe, Cancelar não escreve,
//      a remoção de união checa response.ok e mostra o erro do servidor, e o
//      preview abre para linhaReta/pai/mãe/documentação/remoção.
//
//   npx tsx scripts/arvore-preview-tarefas-abertas.test.ts   (banco de TESTE)
// ============================================================================
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "../lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { criarPalco } from "./_fixture-arvore-fonte"
import { materializarGenealogia } from "../src/services/genealogia/materializar-genealogia"
import { simularImpactoPessoa } from "../src/services/genealogia/simular-impacto"

const MARCA = "ARVPREV"
let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8")

async function estado(processoId: number) {
  return JSON.stringify({
    nec: await prisma.necessidadeDocumental.findMany({ where: { processoId }, orderBy: { id: "asc" }, select: { id: true, status: true } }),
    doc: await prisma.documento.findMany({ where: { pessoa: { arvore: { processos: { some: { id: processoId } } } } }, orderBy: { id: "asc" }, select: { id: true, status: true, necessidadeId: true } }),
    passo: await prisma.phaseWorkflowStepInstance.findMany({ where: { processoId }, orderBy: { id: "asc" }, select: { id: true, status: true } }),
    tarefa: await prisma.tarefa.findMany({ where: { processoId }, orderBy: { id: "asc" }, select: { id: true, statusTarefa: true, causaRemovidaEm: true } }),
    pessoas: await prisma.pessoa.findMany({ where: { arvore: { processos: { some: { id: processoId } } } }, orderBy: { id: "asc" }, select: { id: true, casado: true, linhaReta: true, removidaEm: true } }),
    unioes: await prisma.uniao.count({ where: { pessoa1: { arvore: { processos: { some: { id: processoId } } } } } }),
    logs: await prisma.logAuditoria.count(),
  })
}

async function main() {
  exigirBancoDeTeste("preview de impacto lista tarefas abertas e documentos NAO_EXIGIDO sem gravar nada")
  const palco = criarPalco(MARCA)
  await palco.montar()
  try {
    const c = await palco.novoCenario("casal", { conjuge: true, avo: true })
    const daniela = await prisma.usuario.create({ data: { nome: "Daniela", email: `${MARCA.toLowerCase()}-daniela@arv.test`, senha: "x", tipo: "user" } })
    await prisma.pessoa.update({ where: { id: c.titularId }, data: { casado: true } })
    const uniao = await prisma.uniao.create({ data: { pessoa1Id: c.titularId, pessoa2Id: c.conjugeId!, tipo: "casamento_civil" }, select: { id: true } })
    await materializarGenealogia(c.processoId)
    const base = await palco.foto(c.processoId)
    const tarefaCas = base.tarefas.find((t) => /casamento/i.test(t.titulo))
    const tarefaNasAvo = base.tarefas.find((t) => /nascimento/i.test(t.titulo) && t.necessidadeId === base.necDe("NAS", { pessoaId: c.avoId! })[0]?.id)
    ok("precondição: necessidade de casamento por união, com Documento e tarefa aberta", base.necDe("CAS", { uniaoId: uniao.id }).length === 1 && !!tarefaCas)
    ok("precondição: tarefa do nascimento do avô existe", !!tarefaNasAvo)
    if (!tarefaCas || !tarefaNasAvo) throw new Error("cenário não montou")
    await prisma.tarefa.update({ where: { id: tarefaCas.id }, data: { responsavelId: daniela.id } })

    // ── 1) desmarcar casado ────────────────────────────────────────────────
    secao("1) desmarcar 'casado' (+ desfazer a união) lista a tarefa aberta e o documento")
    const antes = await estado(c.processoId)
    const r1 = await simularImpactoPessoa({ processoId: c.processoId, pessoaId: c.titularId, mudancas: { casado: false }, uniao: { acao: "remover", uniaoId: uniao.id } }, false)
    const t1 = r1.tarefasAfetadas.find((t) => t.tarefaId === tarefaCas.id)
    ok("a tarefa aberta de casamento está na lista", !!t1, JSON.stringify(r1.tarefasAfetadas.map((t) => t.titulo)))
    ok("traz o responsável (Daniela) e a pessoa", t1?.responsavelNome === "Daniela", String(t1?.responsavelNome))
    ok("efeito = CANCELADA (nunca iniciada)", t1?.efeito === "CANCELADA")
    ok("o documento de casamento passa a NAO_EXIGIDO (listado)", r1.documentosNaoExigidos.length === 1 && /casamento/i.test(r1.documentosNaoExigidos[0].documento), JSON.stringify(r1.documentosNaoExigidos))
    ok("não é 'sem impacto'", r1.semImpacto === false)
    ok("NADA foi gravado (necessidade, documento, passo, tarefa, pessoa, união, auditoria)", (await estado(c.processoId)) === antes)

    // ── 2) só desmarcar casado (casado false nos dois lados, união fica) ──
    secao("2) só 'casado' = false (sem apagar a união)")
    await prisma.pessoa.update({ where: { id: c.conjugeId! }, data: { casado: false } }) // já é false; explícito
    const r2 = await simularImpactoPessoa({ processoId: c.processoId, pessoaId: c.titularId, mudancas: { casado: false } }, false)
    ok("a tarefa de casamento também é listada", r2.tarefasAfetadas.some((t) => t.tarefaId === tarefaCas.id))
    ok("NADA foi gravado", (await estado(c.processoId)) === antes)

    // ── 3) sair da linha reta ──────────────────────────────────────────────
    secao("3) sair da linha reta (avô) lista o nascimento dele")
    const r3 = await simularImpactoPessoa({ processoId: c.processoId, pessoaId: c.avoId!, mudancas: { linhaReta: false } }, false)
    ok("a tarefa de nascimento do avô está na lista", r3.tarefasAfetadas.some((t) => t.tarefaId === tarefaNasAvo.id), JSON.stringify(r3.tarefasAfetadas.map((t) => t.titulo)))
    ok("o documento do avô passa a NAO_EXIGIDO (listado)", r3.documentosNaoExigidos.some((d) => /nascimento/i.test(d.documento)))
    ok("NADA foi gravado", (await estado(c.processoId)) === antes)

    // ── 4) remover o cônjuge ───────────────────────────────────────────────
    secao("4) remover a pessoa (cônjuge) leva a certidão de casamento junto")
    const r4 = await simularImpactoPessoa({ processoId: c.processoId, pessoaId: c.conjugeId!, removerPessoa: true }, false)
    ok("tarefa de casamento listada ao remover o cônjuge", r4.tarefasAfetadas.some((t) => t.tarefaId === tarefaCas.id), JSON.stringify(r4.tarefasAfetadas.map((t) => t.titulo)))
    ok("documento do TITULAR (união) listado como NAO_EXIGIDO", r4.documentosNaoExigidos.some((d) => /casamento/i.test(d.documento)))
    ok("NADA foi gravado (cônjuge e união continuam)", (await estado(c.processoId)) === antes)

    // ── 5) tarefa já iniciada ──────────────────────────────────────────────
    secao("5) tarefa JÁ INICIADA: 'DECISAO', não cancelada")
    await prisma.tarefa.update({ where: { id: tarefaCas.id }, data: { statusTarefa: "EM_ANDAMENTO", dataInicio: new Date() } })
    const antes5 = await estado(c.processoId)
    const r5 = await simularImpactoPessoa({ processoId: c.processoId, pessoaId: c.titularId, mudancas: { casado: false }, uniao: { acao: "remover", uniaoId: uniao.id } }, false)
    ok("efeito = DECISAO para a tarefa iniciada", r5.tarefasAfetadas.find((t) => t.tarefaId === tarefaCas.id)?.efeito === "DECISAO", JSON.stringify(r5.tarefasAfetadas))
    ok("NADA foi gravado", (await estado(c.processoId)) === antes5)

    // ── 6) mudança sem efeito ──────────────────────────────────────────────
    secao("6) mudança sem efeito documental não lista nada")
    const r6 = await simularImpactoPessoa({ processoId: c.processoId, pessoaId: c.titularId, mudancas: { linhaReta: true, casado: true } }, false)
    ok("sem tarefas nem documentos afetados", r6.tarefasAfetadas.length === 0 && r6.documentosNaoExigidos.length === 0)
  } finally {
    // (a fixture compartilhada não remove a política da fase que ela mesma cria)
    await prisma.faseNaturezaPermitida.deleteMany({ where: { naturezaOperacional: { code: { startsWith: MARCA } } } })
    await palco.limpar()
  }

  // ── 7) UI — prova por leitura de fonte ─────────────────────────────────
  secao("7) UI: modal 'Isso vai cancelar … Confirmar?', cancelar não escreve, união checa response.ok")
  const modal = ler("src/components/arvore/inteligencia/preview-impacto.tsx")
  const view = ler("src/components/arvore/arvore-genealogica-view.tsx")
  const remocao = ler("src/components/arvore/remocao-pessoa-modal.tsx")
  ok("modal tem 'Isso vai cancelar:' e 'Confirmar?'", /Isso vai cancelar:/.test(modal) && /Confirmar\?/.test(modal))
  ok("lista tarefa aberta com responsável e documento 'Não exigido'", /tarefa aberta/.test(modal) && /Não exigido/.test(modal) && /responsavelNome/.test(modal))
  ok("o modal NÃO escreve: só POST em simular-impacto (nenhum PUT/DELETE)", !/method:\s*["'](PUT|DELETE|PATCH)["']/.test(modal) && /simular-impacto/.test(modal))
  ok("Cancelar só fecha (onCancelar) — não chama persistir", /onCancelar=\{\(\) => setProposta\(null\)\}/.test(view))
  ok("confirmar chama persistir (a única gravação)", /onConfirmar=\{persistir\}/.test(view))
  ok("preview abre também para linha reta, pai, mãe e documentação", /linhaRetaMudou/.test(view) && /documentacaoMudou/.test(view) && /paiMudou/.test(view) && /maeMudou/.test(view)
    && /mudancaRelevante = [\s\S]{0,300}linhaRetaMudou/.test(view))
  ok("remoção de união checa response.ok (DELETE)", /const rDel = await authFetch\(`\/api\/unioes\/\$\{uniaoExistente\.id\}`, \{ method: 'DELETE' \}\)\s*[\s\S]{0,400}uniaoOk\(rDel/.test(view))
  ok("uniaoOk só é sucesso com resp.ok e mostra o erro do servidor", /const uniaoOk[\s\S]{0,300}if \(resp\.ok\) return true[\s\S]{0,200}alert\(corpo\?\.error/.test(view))
  ok("criação e edição de união também checam ok", (view.match(/uniaoOk\(rUniao/g) ?? []).length >= 3)
  ok("sem impacto não pede 'OK' vazio (onSemImpacto)", /onSemImpacto/.test(modal) && /onSemImpacto=\{persistir\}/.test(view))
  ok("modal de remoção de pessoa mostra o que será cancelado (mesma lista) e o plano conta o documento do outro cônjuge",
    /ListaCancelamentos/.test(remocao) && /removerPessoa: true/.test(remocao) && /documentosDeUniaoDoOutroConjuge/.test(remocao)
    && /documentosDeUniaoDoOutroConjuge/.test(ler("src/services/pessoa-ciclo-vida.ts")))

  console.log(`\n${falhou === 0 ? "✅" : "❌"} PREVIEW TAREFAS ABERTAS — ${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log("Falhas: " + falhas.join("; ")); process.exit(1) }
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
