// scripts/saude-arv002-arvore-e-derivados.test.ts
// ============================================================================
// ARV-002 — "A árvore e seus derivados concordam" (CLAUDE.md §37, 30/09/2026).
// Cria CADA situação acusável e prova que acusa com a chave esperada; prova que o
// estado limpo NÃO acusa (inclusive RG sem Documento e Documento NAO_EXIGIDO).
//
//   (i)   Documento automático ativo sem necessidade            → ARV-002:doc:<id>        ERRO
//   (ii)  certidão exigida sem Documento (RG/endereço não)       → ARV-002:nec-sem-doc:<id> ALERTA
//   (iii) tarefa aberta cujo Documento não tem necessidade ativa → ARV-002:tarefa:<id>     ERRO
//   (iv)  necessidade de união cujo casal não vale mais          → ARV-002:uniao:<id>      ERRO
//   (v)   necessidade ATENDIDA cuja causa sumiu                  → ARV-002:nec:<id>        ALERTA
//
//   node scripts/ci/gate-build.mjs --suite todas --so saude-arv002
// Roda contra o banco de TESTE. Não toca em produção.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("saude-arv002-arvore-e-derivados.test.ts")

import { prisma } from "../lib/prisma"
import { verificacaoPorCodigo } from "../lib/saude/catalogo"
import "../lib/saude/verificacoes/genealogia"

const MARCA = "ARV001"
let passou = 0, falhou = 0
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; console.log(`  ❌ ${n} ${extra}`) } }

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const arvIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
  await prisma.logAuditoria.deleteMany({ where: { descricao: { contains: MARCA } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: { in: arvIds } } } })
  await prisma.necessidadeDocumentalEvento.deleteMany({ where: { necessidade: { processoId: { in: ids } } } })
  await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.uniao.deleteMany({ where: { pessoa1: { arvoreId: { in: arvIds } } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvIds } } })
  await prisma.arvore.deleteMany({ where: { id: { in: arvIds } } })
  await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.perfilOperacionalDocumento.deleteMany({ where: { code: { startsWith: MARCA } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: MARCA } } })
  await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: MARCA } } })
}

async function main() {
  await limpar()
  try {
    // Item que GERA Documento (tipo com perfil+workflow) e item que NÃO gera (RG).
    const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}-wf`, phaseKey: "emissao_documental", name: `${MARCA} wf`, active: true }, select: { id: true } })
    const perfil = await prisma.perfilOperacionalDocumento.create({ data: { code: `${MARCA}_PERFIL`, name: `${MARCA} perfil`, workflowId: wf.id }, select: { id: true } })
    const itemCert = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_CERT`, name: "Certidão ARV001", natureza: "DOCUMENTO" }, select: { id: true } })
    const itemRg = await prisma.itemCatalogo.create({ data: { code: `${MARCA}_RG`, name: "RG ARV001", natureza: "DOCUMENTO" }, select: { id: true } })
    await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}_T_CERT`, name: "Certidão ARV001", itemCatalogoId: itemCert.id, perfilOperacionalId: perfil.id } })
    await prisma.tipoDocumentoCadastro.create({ data: { code: `${MARCA}_T_RG`, name: "RG ARV001", itemCatalogoId: itemRg.id } })

    let seq = 0
    const familia = async (casados = true) => {
      seq++
      const arv = await prisma.arvore.create({ data: { nome: `${MARCA} fam ${seq}` }, select: { id: true } })
      const proc = await prisma.processo.create({ data: { nome: `${MARCA} proc ${seq}`, arvoreId: arv.id, faseAtualKey: "genealogia" }, select: { id: true } })
      const a = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Ana", sobrenome: `F${seq}`, linhaReta: true, casado: casados }, select: { id: true } })
      const b = await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Beto", sobrenome: `F${seq}`, linhaReta: true, casado: casados }, select: { id: true } })
      const u = await prisma.uniao.create({ data: { pessoa1Id: a.id, pessoa2Id: b.id, tipo: "casamento_civil" }, select: { id: true } })
      return { arvoreId: arv.id, processoId: proc.id, a: a.id, b: b.id, uniaoId: u.id }
    }
    const nec = (f: { processoId: number; arvoreId: number }, item: number, extra: Record<string, unknown>) =>
      prisma.necessidadeDocumental.create({
        data: { processoId: f.processoId, arvoreId: f.arvoreId, itemCatalogoId: item, ciclo: 1, chaveIdempotencia: `${MARCA}-${Math.random().toString(36).slice(2)}`, origem: "MATRIZ", varianteKey: `rd:${MARCA}:v1`, ...extra } as never,
        select: { id: true },
      })

    // ── ESTADO LIMPO ───────────────────────────────────────────────────────
    const limpa = await familia(true)
    const necOk = await nec(limpa, itemCert.id, { pessoaId: limpa.a, status: "PENDENTE" })
    await prisma.documento.create({ data: { pessoaId: limpa.a, necessidadeId: necOk.id, origem: "automatica", status: "PENDENTE" } })
    await nec(limpa, itemRg.id, { pessoaId: limpa.a, status: "PENDENTE", varianteKey: "padrao", origem: "MANUAL" }) // RG: sem Documento, NÃO acusa
    const necUniaoOk = await nec(limpa, itemCert.id, { uniaoId: limpa.uniaoId, status: "PENDENTE", varianteKey: "padrao", origem: "MANUAL" })
    await prisma.documento.create({ data: { pessoaId: limpa.a, necessidadeId: necUniaoOk.id, origem: "automatica", status: "PENDENTE" } })
    await prisma.documento.create({ data: { pessoaId: limpa.b, origem: "automatica", status: "NAO_EXIGIDO" } }) // órfão MAS NAO_EXIGIDO: não acusa

    // ── (i) Documento automático sem necessidade ───────────────────────────
    const fi = await familia(true)
    const docOrfao = await prisma.documento.create({ data: { pessoaId: fi.a, origem: "automatica", status: "PENDENTE" }, select: { id: true } })

    // ── (ii) certidão exigida sem Documento ────────────────────────────────
    const fii = await familia(true)
    const necSemDoc = await nec(fii, itemCert.id, { pessoaId: fii.a, status: "PENDENTE" })

    // ── (iii) tarefa aberta cujo Documento não tem necessidade ─────────────
    const fiii = await familia(true)
    const docT = await prisma.documento.create({ data: { pessoaId: fiii.a, origem: "automatica", status: "PENDENTE" }, select: { id: true } })
    const tarefa = await prisma.tarefa.create({ data: { titulo: `${MARCA} tarefa fantasma`, processoId: fiii.processoId, documentoId: docT.id, origem: "workflow" } as never, select: { id: true } })

    // ── (iv) necessidade de união cujo casal não vale mais ─────────────────
    const fiv = await familia(false) // nenhum dos dois casado
    const necUniao = await nec(fiv, itemCert.id, { uniaoId: fiv.uniaoId, status: "PENDENTE", varianteKey: "padrao", origem: "MANUAL" })
    await prisma.documento.create({ data: { pessoaId: fiv.a, necessidadeId: necUniao.id, origem: "automatica", status: "PENDENTE" } })

    // ── (v) necessidade ATENDIDA cuja causa sumiu (nenhuma regra publicada aplica) ─
    const fv = await familia(true)
    const necAtendida = await nec(fv, itemCert.id, { pessoaId: fv.a, status: "ATENDIDA" })
    await prisma.documento.create({ data: { pessoaId: fv.a, necessidadeId: necAtendida.id, origem: "automatica", status: "RECEBIDO" } })

    const v = verificacaoPorCodigo("ARV-002")!
    ok("ARV-002 está no catálogo, em RAPIDO/COMPLETO/PROFUNDO", !!v && ["RAPIDO", "COMPLETO", "PROFUNDO"].every((m) => (v.modos as string[]).includes(m)))
    const r = await v.executar({} as never)
    const por = new Map(r.achados.map((a) => [a.chave, a]))

    console.log("\n(i) Documento sem necessidade")
    ok("acusa ARV-002:doc:<id> como ERRO", por.get(`ARV-002:doc:${docOrfao.id}`)?.severidade === "ERRO")
    ok("o achado nomeia a certidão/pessoa e o link leva ao processo", (por.get(`ARV-002:doc:${docOrfao.id}`)?.titulo ?? "").includes("Ana") && por.get(`ARV-002:doc:${docOrfao.id}`)?.link === `/processos/${fi.processoId}`)

    console.log("\n(ii) certidão sem Documento")
    ok("acusa ARV-002:nec-sem-doc:<id> (ALERTA)", por.get(`ARV-002:nec-sem-doc:${necSemDoc.id}`)?.severidade === "ALERTA")

    console.log("\n(iii) tarefa cujo Documento não tem necessidade")
    ok("acusa ARV-002:tarefa:<id> como ERRO", por.get(`ARV-002:tarefa:${tarefa.id}`)?.severidade === "ERRO")

    console.log("\n(iv) necessidade de união sem casal")
    ok("acusa ARV-002:uniao:<id> como ERRO", por.get(`ARV-002:uniao:${necUniao.id}`)?.severidade === "ERRO")

    console.log("\n(v) necessidade atendida que perdeu a causa")
    const a5 = por.get(`ARV-002:nec:${necAtendida.id}`)
    ok("acusa ARV-002:nec:<id> como ALERTA (não erro)", a5?.severidade === "ALERTA")
    ok("o texto diz que foi MANTIDA e requer decisão humana", /MANTEVE/.test(a5?.descricao ?? "") && /humana/.test(a5?.recomendacao ?? ""))

    console.log("\nEstado limpo NÃO acusa")
    const doProcessoLimpo = r.achados.filter((a) => (a.evidencia as { processoId?: number } | undefined)?.processoId === limpa.processoId)
    ok("nenhum achado para o processo limpo (RG sem Documento, NAO_EXIGIDO e união válida incluídos)", doProcessoLimpo.length === 0, JSON.stringify(doProcessoLimpo.map((a) => a.chave)))
    ok("o RG sem Documento não é acusado", ![...por.keys()].some((k) => k.startsWith("ARV-002:nec-sem-doc") && k.endsWith(`:${necOk.id + 1}`)))
  } finally {
    await limpar()
  }
  console.log(`\n${falhou === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${passou} ok, ${falhou} falhas`)
  if (falhou) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
