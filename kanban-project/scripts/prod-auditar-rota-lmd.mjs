// scripts/prod-auditar-rota-lmd.mjs
// ============================================================================
// AUDITORIA DA ROTA OPERACIONAL — Nacionalidade Espanhola / Lei da Memória
// Democrática. SOMENTE LEITURA.
//
// Responde uma pergunta só: o que JÁ EXISTE em produção, por domínio, para essa
// rota. Sem isso, qualquer cadastro corre o risco de duplicar o que já está lá.
//
// Não escreve nada. Nunca derruba o build.
// ============================================================================
import { PrismaClient } from '@prisma/client'
import { identificador, retratar } from '../lib/db/identidade-banco.mjs'

const prisma = new PrismaClient()
const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ''
const L = (m) => console.log(`[lmd] ${m}`)

async function main() {
  const r = await retratar(prisma)
  L(`alvo: ${identificador(url)} (tabelas=${r.tabelas}, migrations=${r.migrations})`)

  // ── 1) Países e Regiões ──────────────────────────────────────────────────
  const paises = await prisma.catalogoPais.findMany({ orderBy: { countryLabel: 'asc' } })
  L(`\n1) PAÍSES E REGIÕES: ${paises.length}`)
  for (const p of paises) L(`   #${p.id} ${p.countryKey} · ${p.countryLabel} · ${p.nationalityLabel} · ${p.defaultCurrency} · ativo=${p.ativo}`)
  const espanha = paises.find((p) => p.countryKey === 'espanha')

  // ── 2) Tipos de Processo ─────────────────────────────────────────────────
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, countryKey: true, nationalityLabel: true, modalityKey: true, ativo: true },
  })
  L(`\n2) TIPOS DE PROCESSO: ${tipos.length}`)
  for (const t of tipos) L(`   #${t.id} ${t.countryKey}/${t.modalityKey ?? '—'} · ${t.name} · ativo=${t.ativo}`)
  const tiposEsp = tipos.filter((t) => t.countryKey === 'espanha')

  // ── 3) Modalidades ───────────────────────────────────────────────────────
  const mods = await prisma.modalidadePais.findMany({ orderBy: [{ countryKey: 'asc' }, { ordem: 'asc' }] })
  L(`\n3) MODALIDADES: ${mods.length}`)
  for (const m of mods) L(`   #${m.id} ${m.countryKey}/${m.modalityKey} · ${m.modalityLabel} · ativo=${m.ativo}`)

  // ── 4) Serviços ──────────────────────────────────────────────────────────
  const servicos = await prisma.servicoProduto.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, publicCode: true, name: true, ativo: true, aplicacaoGlobal: true,
      itemCatalogo: { select: { id: true, categoria: { select: { code: true } } } },
      paises: { select: { pais: { select: { countryKey: true } } } } },
  })
  L(`\n4) SERVIÇOS: ${servicos.length}`)
  for (const s of servicos) {
    const terr = s.aplicacaoGlobal ? 'GLOBAL' : s.paises.map((p) => p.pais.countryKey).join('+') || 'sem território'
    L(`   #${s.id} ${s.publicCode} · ${s.name} · cat=${s.itemCatalogo?.categoria?.code ?? '—'} · ${terr} · ativo=${s.ativo}`)
  }

  // ── 5-7) Workflow macro / Fases / Marcos ─────────────────────────────────
  const macros = await prisma.macroWorkflow.findMany({
    select: { id: true, name: true, ativo: true, versao: true, tipoProcessoId: true,
      tipoProcesso: { select: { name: true, countryKey: true } },
      fases: { select: { phaseKey: true, label: true, ordem: true, required: true }, orderBy: { ordem: 'asc' } } },
  })
  L(`\n5) WORKFLOW MACRO: ${macros.length}`)
  for (const m of macros) {
    L(`   #${m.id} [${m.tipoProcesso?.countryKey}] ${m.name} v${m.versao} ativo=${m.ativo} · ${m.fases.length} fase(s)`)
    for (const f of m.fases) L(`      ${f.ordem}. ${f.phaseKey} — ${f.label}${f.required ? '' : ' (opcional)'}`)
  }
  const cat = await prisma.catalogoFase.findMany({ orderBy: { phaseKey: 'asc' }, select: { phaseKey: true, label: true, ativo: true } })
  L(`\n6) CATÁLOGO DE FASES: ${cat.length}`)
  L(`   ${cat.map((c) => c.phaseKey).join(', ')}`)
  const marcos = await prisma.marcoProcesso.count()
  L(`\n7) MARCOS: ${marcos}`)

  // ── 8) Workflow interno (variações da fase) ──────────────────────────────
  const wfi = await prisma.phaseInternalWorkflow.findMany({
    where: { arquivado: false },
    select: { id: true, name: true, phaseKey: true, tipoProcessoId: true, active: true, versao: true, _count: { select: { passos: true } } },
    orderBy: { id: 'asc' },
  })
  L(`\n8) WORKFLOWS INTERNOS: ${wfi.length}`)
  for (const w of wfi) L(`   #${w.id} fase=${w.phaseKey} tipoProc=${w.tipoProcessoId ?? 'TODOS'} · ${w.name} v${w.versao} · ${w._count.passos} passo(s) · ativo=${w.active}`)

  // ── 9) Documentos Mestres ────────────────────────────────────────────────
  const docs = await prisma.tipoDocumentoCadastro.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true, ativo: true, countryCode: true, itemCatalogoId: true },
  })
  L(`\n9) DOCUMENTOS MESTRES: ${docs.length}`)
  for (const d of docs) L(`   #${d.id} ${d.code ?? '—'} · ${d.name} · país=${d.countryCode ?? '—'} · item=${d.itemCatalogoId ?? '—'} · ativo=${d.ativo}`)

  // ── 10) Matriz Documental ────────────────────────────────────────────────
  const matriz = await prisma.matrizDocumental.count()
  L(`\n10) MATRIZ DOCUMENTAL: ${matriz} regra(s)`)

  // ── 11) Órgãos e Organizações ────────────────────────────────────────────
  const orgaos = await prisma.orgaoProtocolo.findMany({ select: { id: true, nome: true, ativo: true }, orderBy: { nome: 'asc' } })
  L(`\n11) ÓRGÃOS: ${orgaos.length}`)
  for (const o of orgaos.slice(0, 15)) L(`   #${o.id} ${o.nome} ativo=${o.ativo}`)

  // ── 12) Protocolos ───────────────────────────────────────────────────────
  const tprot = await prisma.tipoProtocoloCadastro.findMany({ select: { id: true, nome: true, ativo: true } })
  L(`\n12) TIPOS DE PROTOCOLO: ${tprot.length}`)
  for (const t of tprot) L(`   #${t.id} ${t.nome} ativo=${t.ativo}`)

  // ── 13-14) Financeiro ────────────────────────────────────────────────────
  const cfgs = await prisma.produtoFinanceiro.count({ where: { ativo: true } })
  const precos = await prisma.tabelaValor.findMany({
    where: { arquivado: false },
    select: { id: true, name: true, natureza: true, moeda: true, valor: true, valorBase: true, valorAdicional: true, modoCalculo: true,
      configuracaoFinanceiraItem: { select: { itemCatalogo: { select: { name: true, natureza: true } } } } },
  })
  L(`\n13) CONFIGURAÇÕES FINANCEIRAS ATIVAS: ${cfgs}`)
  L(`14) TABELA DE VALORES: ${precos.length} preço(s)`)
  for (const p of precos) L(`   #${p.id} ${p.configuracaoFinanceiraItem?.itemCatalogo?.name ?? p.name} · ${p.natureza} · ${p.moeda} · ${p.modoCalculo} · base=${p.valorBase ?? p.valor} adic=${p.valorAdicional ?? '—'}`)

  // ── 15) Usuários e Acessos ───────────────────────────────────────────────
  const usuarios = await prisma.usuario.count()
  const perfis = await prisma.perfil.findMany({ select: { id: true, nome: true } })
  L(`\n15) USUÁRIOS: ${usuarios} · PERFIS: ${perfis.map((p) => p.nome).join(', ') || '—'}`)

  // ── 16) Automações ───────────────────────────────────────────────────────
  const autos = await prisma.phaseAutomationRule.findMany({
    where: { arquivado: false },
    select: { id: true, kind: true, trigger: true, phaseKey: true, tipoProcessoId: true, active: true },
  })
  L(`\n16) AUTOMAÇÕES: ${autos.length}`)
  for (const a of autos) L(`   #${a.id} ${a.kind}/${a.trigger} fase=${a.phaseKey ?? '—'} tipoProc=${a.tipoProcessoId ?? 'TODOS'} ativo=${a.active}`)

  // ── 17) Papéis das pessoas ───────────────────────────────────────────────
  const req = await prisma.requerente.count()
  L(`\n17) REQUERENTES: ${req}`)

  // ── VEREDITO ESPANHA/LMD ─────────────────────────────────────────────────
  L(`\n${'='.repeat(60)}`)
  L(`ESPANHA: país ${espanha ? `#${espanha.id} OK` : 'AUSENTE'}`)
  L(`ESPANHA: tipos de processo = ${tiposEsp.length}${tiposEsp.length ? ` (${tiposEsp.map((t) => t.name).join('; ')})` : ''}`)
  L(`ESPANHA: modalidades = ${mods.filter((m) => m.countryKey === 'espanha').map((m) => m.modalityKey).join(', ') || 'NENHUMA'}`)
  L(`ESPANHA: macro workflow = ${macros.filter((m) => m.tipoProcesso?.countryKey === 'espanha').length}`)
  await prisma.$disconnect()
}
main().catch(async (e) => { L(`AVISO: auditoria não concluída (${String(e?.message ?? e).slice(0, 200)})`); await prisma.$disconnect() })
