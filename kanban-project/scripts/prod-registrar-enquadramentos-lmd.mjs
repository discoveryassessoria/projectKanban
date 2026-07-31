// scripts/prod-registrar-enquadramentos-lmd.mjs
// ============================================================================
// Registra a modalidade legal LMD e os enquadramentos Anexo I e Anexo III, e
// trata as regras órfãs da Matriz Documental. Idempotente e transacional.
//
// Só entra o que está comprovado: Anexo II não é presumido, "menores vinculados"
// não vira enquadramento, e nenhuma descrição jurídica é inventada.
//
// ÓRFÃS: 5 regras da Matriz Documental apontam para `tipoProcessoId = 0`, que não
// existe. Elas nunca são aplicadas — são dado morto que ainda aparece em
// contagem e relatório. Não são APAGADAS: ficam `arquivado = true`, preservando
// o conteúdo para reconciliação, e saem do caminho do motor.
// ============================================================================
import { PrismaClient } from '@prisma/client'
import { identificador, retratar } from '../lib/db/identidade-banco.mjs'

const prisma = new PrismaClient()
const url = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL || ''
const L = (m) => console.log(`[lmd-reg] ${m}`)

// Espelha prisma/enquadramentos-legais-oficiais.ts — o guard compara os dois.
const MODALIDADES = [
  {
    code: 'ES_LMD', nome: 'Lei da Memória Democrática', paisCountryKey: 'espanha', ordem: 1,
    enquadramentos: [
      { code: 'ES_LMD_ANEXO_I', nome: 'Anexo I', ordem: 1 },
      { code: 'ES_LMD_ANEXO_III', nome: 'Anexo III', ordem: 3 },
    ],
  },
]

async function main() {
  const r = await retratar(prisma)
  L(`alvo: ${identificador(url)} (tabelas=${r.tabelas}, migrations=${r.migrations})`)
  if (!prisma.modalidadeLegal) { L('AVISO: migration ainda não aplicada — nada a fazer.'); await prisma.$disconnect(); return }

  // ── 1) Modalidade legal + enquadramentos ────────────────────────────────
  for (const m of MODALIDADES) {
    const pais = await prisma.catalogoPais.findUnique({ where: { countryKey: m.paisCountryKey }, select: { id: true, countryLabel: true } })
    if (!pais) { L(`⚠ país "${m.paisCountryKey}" ausente — modalidade ${m.code} não registrada.`); continue }
    const mod = await prisma.modalidadeLegal.upsert({
      where: { code: m.code },
      create: { code: m.code, nome: m.nome, ordem: m.ordem, paisId: pais.id, ativo: true },
      update: { nome: m.nome, ordem: m.ordem, paisId: pais.id },
      select: { id: true, code: true, nome: true },
    })
    L(`✓ modalidade legal #${mod.id} [${mod.code}] ${mod.nome} · país #${pais.id} ${pais.countryLabel}`)
    for (const e of m.enquadramentos) {
      const enq = await prisma.enquadramentoLegal.upsert({
        where: { code: e.code },
        create: { code: e.code, nome: e.nome, ordem: e.ordem, modalidadeLegalId: mod.id, ativo: true },
        update: { nome: e.nome, ordem: e.ordem, modalidadeLegalId: mod.id },
        select: { id: true, code: true, nome: true },
      })
      L(`   ✓ enquadramento #${enq.id} [${enq.code}] ${enq.nome} → modalidade #${mod.id}`)
    }
  }
  const total = await prisma.enquadramentoLegal.count()
  L(`enquadramentos cadastrados: ${total}`)

  // ── 2) Regras órfãs da Matriz Documental ────────────────────────────────
  const tipos = new Set((await prisma.tipoProcessoNacionalidade.findMany({ select: { id: true } })).map((t) => t.id))
  const regras = await prisma.matrizDocumental.findMany({
    where: { arquivado: false },
    select: { id: true, tipoProcessoId: true, documentTypeCode: true, phaseKey: true },
  })
  const orfas = regras.filter((g) => !tipos.has(g.tipoProcessoId))
  L(`matriz documental: ${regras.length} regra(s) ativa(s) · órfãs: ${orfas.length}`)
  if (orfas.length === 0) { L('OK — nenhuma regra órfã.'); await prisma.$disconnect(); return }
  for (const o of orfas) L(`   órfã #${o.id} tipoProcesso=${o.tipoProcessoId} · ${o.documentTypeCode} · fase=${o.phaseKey ?? '—'}`)

  await prisma.$transaction(async (tx) => {
    await tx.matrizDocumental.updateMany({ where: { id: { in: orfas.map((o) => o.id) } }, data: { arquivado: true } })
    await tx.logAuditoria.create({
      data: {
        acao: 'EDITAR', entidade: 'MatrizDocumental', entidadeId: null,
        descricao: `${orfas.length} regra(s) documental(is) arquivada(s): apontavam para tipo de processo inexistente`,
        detalhes: { regras: orfas, motivo: 'tipoProcessoId sem correspondência — regra nunca aplicável' },
      },
    })
  })
  L(`✓ ${orfas.length} regra(s) órfã(s) arquivada(s) — conteúdo preservado, fora do motor`)
  await prisma.$disconnect()
}
main().catch(async (e) => { L(`AVISO: não concluído (${String(e?.message ?? e).slice(0, 200)})`); await prisma.$disconnect() })
