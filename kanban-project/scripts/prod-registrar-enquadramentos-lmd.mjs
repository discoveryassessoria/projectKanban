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
//
// NÃO roda no build. É operação administrativa explícita:
//   npm run prod:registrar-enquadramentos-lmd
// exigindo VERCEL_ENV=production, PROD_REGISTRAR_ENQUADRAMENTOS_LMD=APLICAR,
// PRISMA_DATABASE_URL e identidade do banco classificada como PRODUCAO.
// ============================================================================
import { PrismaClient } from '@prisma/client'
import { rodarScriptProducao } from '../lib/db/guarda-escrita-producao.mjs'

const NOME = 'lmd-reg'
const FLAG = 'PROD_REGISTRAR_ENQUADRAMENTOS_LMD'
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

async function registrarEnquadramentos({ prisma }) {
  if (!prisma.modalidadeLegal) { L('AVISO: migration ainda não aplicada — nada a fazer.'); return }

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
  if (orfas.length === 0) { L('OK — nenhuma regra órfã.'); return }
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

  // Conferência: nenhuma órfã pode ter sobrado ativa.
  const tiposDepois = new Set((await prisma.tipoProcessoNacionalidade.findMany({ select: { id: true } })).map((t) => t.id))
  const ativasDepois = await prisma.matrizDocumental.findMany({ where: { arquivado: false }, select: { id: true, tipoProcessoId: true } })
  const orfasRestantes = ativasDepois.filter((g) => !tiposDepois.has(g.tipoProcessoId))
  if (orfasRestantes.length > 0) {
    throw new Error(`${orfasRestantes.length} regra(s) órfã(s) continuam ativas após o arquivamento`)
  }
  L('✓ conferido: nenhuma regra órfã ativa restante')
}

await rodarScriptProducao({
  nome: NOME,
  flag: FLAG,
  criarPrisma: () => new PrismaClient(),
  operacao: registrarEnquadramentos,
})
