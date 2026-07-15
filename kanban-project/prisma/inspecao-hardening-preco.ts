// prisma/inspecao-hardening-preco.ts
// ============================================================================
// INSPEÇÃO SOMENTE-LEITURA para o hardening R13–R20 da Tabela de Preços.
// Nada é escrito. Conecta usando a URL passada em INSPECT_DB_URL (evita depender
// de PRISMA_DATABASE_URL). Uso:
//   INSPECT_DB_URL="$DIRECT_DATABASE_URL" npx tsx prisma/inspecao-hardening-preco.ts
// ============================================================================
import { PrismaClient } from '@prisma/client'

const url = process.env.INSPECT_DB_URL
if (!url) { console.error('Defina INSPECT_DB_URL (read-only).'); process.exit(1) }
const prisma = new PrismaClient({ datasources: { db: { url } } })

// ---- helpers ----
const mask = (o: Record<string, unknown>, keys: string[]) =>
  keys.map((k) => (o[k] != null ? '1' : '0')).join('')

function overlaps(aI: string | null, aF: string | null, bI: string | null, bF: string | null) {
  // vigência aberta = infinita. Compara strings ISO 'YYYY-MM-DD' (ordenáveis).
  const aStart = aI ?? '0000-00-00', aEnd = aF ?? '9999-99-99'
  const bStart = bI ?? '0000-00-00', bEnd = bF ?? '9999-99-99'
  return aStart <= bEnd && bStart <= aEnd
}

async function main() {
  // ===== R14 — como os mestres estão preenchidos em ProdutoFinanceiro =====
  const cfgs = await prisma.produtoFinanceiro.findMany({
    select: {
      id: true, codigo: true, papelFinanceiro: true, ativo: true,
      tipoDocumentoId: true, honorarioId: true, tipoProcessoId: true, itemCatalogoId: true,
      tipoDocumento: { select: { itemCatalogoId: true } },
    },
  })
  const MASTER_KEYS = ['tipoDocumentoId', 'honorarioId', 'tipoProcessoId', 'itemCatalogoId']
  const distMask = new Map<string, number>()
  let itemIsDocMirror = 0, itemStandaloneService = 0, semNenhum = 0, comPapelNull = 0
  for (const c of cfgs) {
    const m = mask(c as any, MASTER_KEYS)
    distMask.set(m, (distMask.get(m) ?? 0) + 1)
    if (c.papelFinanceiro == null) comPapelNull++
    const nMasters = MASTER_KEYS.filter((k) => (c as any)[k] != null).length
    if (nMasters === 0) semNenhum++
    // quando itemCatalogoId é o espelho do próprio tipoDocumento (doc), não conta como 2º mestre
    if (c.itemCatalogoId != null && c.tipoDocumentoId != null &&
        c.tipoDocumento?.itemCatalogoId === c.itemCatalogoId) itemIsDocMirror++
    if (c.itemCatalogoId != null && c.tipoDocumentoId == null && c.honorarioId == null && c.tipoProcessoId == null) itemStandaloneService++
  }

  // ===== R16 — duplicidade lógica sob a chave MAIS COMPLETA =====
  const precos = await prisma.tabelaValor.findMany({
    where: { arquivado: false },
    select: {
      id: true, configuracaoFinanceiraItemId: true, processoTipoId: true, modalidadeId: true,
      fornecedorId: true, moeda: true, modoCalculo: true, unidade: true,
      quantidadeMinima: true, quantidadeMaxima: true, prioridade: true,
      vigenciaInicio: true, vigenciaFim: true, valor: true, legadoPendente: true,
    },
  })
  const ativosCanon = precos.filter((p) => p.configuracaoFinanceiraItemId != null && !p.legadoPendente)
  // chave completa (todas as dimensões da R16, exceto vigência que é R17)
  const fullKey = (p: any) => [
    p.configuracaoFinanceiraItemId, p.processoTipoId ?? '', p.modalidadeId ?? -1, p.fornecedorId ?? -1,
    p.moeda, p.modoCalculo, p.unidade ?? '', String(p.quantidadeMinima ?? ''), String(p.quantidadeMaxima ?? ''),
    p.prioridade,
  ].join('|')
  const byFull = new Map<string, number[]>()
  for (const p of ativosCanon) { const k = fullKey(p); (byFull.get(k) ?? byFull.set(k, []).get(k)!).push(p.id) }
  const dupFull = [...byFull.entries()].filter(([, ids]) => ids.length > 1)

  // chave do índice ATUAL (sem moeda/modoCalculo/unidade/quantidade) — mostra quantos hoje
  // seriam bloqueados por diferirem SÓ nessas dims (falso-positivo de duplicidade / R13)
  const idxKey = (p: any) => [
    p.configuracaoFinanceiraItemId, p.processoTipoId ?? '', p.modalidadeId ?? -1, p.fornecedorId ?? -1,
    p.prioridade, p.vigenciaInicio ?? '', p.vigenciaFim ?? '',
  ].join('|')
  const byIdx = new Map<string, any[]>()
  for (const p of ativosCanon) { const k = idxKey(p); (byIdx.get(k) ?? byIdx.set(k, []).get(k)!).push(p) }
  // grupos que colidem no índice atual mas são LEGÍTIMOS (diferem em moeda/qty/unidade/modo)
  const colisaoLegitima = [...byIdx.entries()].filter(([, ps]) => {
    if (ps.length < 2) return false
    const distintosFull = new Set(ps.map(fullKey))
    return distintosFull.size === ps.length // todos distintos na chave completa
  })

  // ===== R17 — sobreposição de vigência no mesmo contexto (ignorando vigência) =====
  const ctxKey = (p: any) => [
    p.configuracaoFinanceiraItemId, p.processoTipoId ?? '', p.modalidadeId ?? -1, p.fornecedorId ?? -1,
    p.moeda, p.unidade ?? '', String(p.quantidadeMinima ?? ''), String(p.quantidadeMaxima ?? ''),
  ].join('|')
  const byCtx = new Map<string, any[]>()
  for (const p of ativosCanon) { const k = ctxKey(p); (byCtx.get(k) ?? byCtx.set(k, []).get(k)!).push(p) }
  const overlapsEncontrados: { ctx: string; a: number; b: number; prioridadeIgual: boolean }[] = []
  for (const [k, ps] of byCtx) {
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      if (overlaps(ps[i].vigenciaInicio, ps[i].vigenciaFim, ps[j].vigenciaInicio, ps[j].vigenciaFim)) {
        overlapsEncontrados.push({ ctx: k, a: ps[i].id, b: ps[j].id, prioridadeIgual: ps[i].prioridade === ps[j].prioridade })
      }
    }
  }

  // datas de vigência que NÃO são ISO 'YYYY-MM-DD' (R17 depende de datas ordenáveis)
  const isoRe = /^\d{4}-\d{2}-\d{2}$/
  const vigNaoIso = ativosCanon.filter((p) =>
    (p.vigenciaInicio && !isoRe.test(p.vigenciaInicio)) || (p.vigenciaFim && !isoRe.test(p.vigenciaFim)))

  console.log(JSON.stringify({
    totais: {
      configs: cfgs.length, configsPapelNull: comPapelNull, configsSemMestre: semNenhum,
      precosAtivos: precos.length, precosCanonicos: ativosCanon.length,
      precosLegadoPendente: precos.filter((p) => p.legadoPendente).length,
      precosSemConfig: precos.filter((p) => p.configuracaoFinanceiraItemId == null).length,
    },
    R14_mascaraMestres: Object.fromEntries([...distMask.entries()].sort()),
    R14_notas: { itemComoEspelhoDoc: itemIsDocMirror, itemServicoStandalone: itemStandaloneService, configsSemNenhumMestre: semNenhum },
    R16_dupChaveCompleta: dupFull.map(([k, ids]) => ({ chave: k, ids })),
    R16_colisaoLegitimaNoIndiceAtual: colisaoLegitima.map(([k, ps]) => ({ chaveIdx: k, ids: ps.map((p: any) => p.id), moedas: [...new Set(ps.map((p: any) => p.moeda))] })),
    R17_sobreposicoesVigencia: overlapsEncontrados,
    R17_vigenciaNaoIso: vigNaoIso.map((p) => ({ id: p.id, ini: p.vigenciaInicio, fim: p.vigenciaFim })),
  }, null, 2))
}

main().catch((e) => { console.error('ERRO (read-only):', e); process.exit(1) }).finally(() => prisma.$disconnect())
