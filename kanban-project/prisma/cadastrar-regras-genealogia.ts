// prisma/cadastrar-regras-genealogia.ts
//
// REGRAS DOCUMENTAIS CANÔNICAS DA GENEALOGIA + a política de naturezas da fase.
//
// Tudo por CADASTRO e por ID. Nenhuma regra por posição na árvore (pai, mãe,
// avô): as condições usam apenas atributos da PESSOA — requerente, maioridade,
// estado civil, falecimento. A mesma regra civil alcança o requerente e o
// trisavô, porque a posição não altera qual certidão a pessoa precisa.
//
// Idempotente: reconhece pelo `codigo` da regra e atualiza no lugar.
//
//   npx tsx prisma/cadastrar-regras-genealogia.ts            # relatório
//   npx tsx prisma/cadastrar-regras-genealogia.ts --execute  # cadastra e publica

import { prisma } from '@/lib/prisma'

const EXECUTAR = process.argv.includes('--execute')
const FASE = 'genealogia'

// Naturezas que a Genealogia passa a aceitar. A fase deixa de ser "só certidão".
const NATUREZAS_DA_FASE = ['OBTIDO_EXTERNAMENTE', 'GERADO_PELO_SISTEMA', 'RECEBIDO_DO_CLIENTE']

// Vínculos que faltam nos tipos documentais não-cartoriais. Perfil fica NULL de
// propósito: é a ausência de perfil que impede o documento de herdar o workflow
// de emissão de certidão.
const VINCULOS: { code: string; familia: string; natureza: string; categoria: string; item: { code: string; name: string } }[] = [
  { code: 'RG',       familia: 'DOCUMENTO_IDENTIDADE', natureza: 'RECEBIDO_DO_CLIENTE', categoria: 'IDENTIDADE', item: { code: 'DOC_RG', name: 'RG' } },
  { code: 'CNH',      familia: 'DOCUMENTO_IDENTIDADE', natureza: 'RECEBIDO_DO_CLIENTE', categoria: 'IDENTIDADE', item: { code: 'DOC_CNH', name: 'CNH' } },
  { code: 'COMP-RES', familia: 'COMPROVANTE',          natureza: 'RECEBIDO_DO_CLIENTE', categoria: 'OUTRO',      item: { code: 'DOC_COMP_RES', name: 'Comprovante de Endereço' } },
  { code: 'OUTRO',    familia: 'PROCURACAO',           natureza: 'GERADO_PELO_SISTEMA', categoria: 'OUTRO',      item: { code: 'DOC_PROC_ADM', name: 'Procuração Administrativa' } },
]

interface RegraSpec {
  codigo: string
  nome: string
  requisito: string
  documentTypeCode: string
  documentosAceitos: string[]
  modoSatisfacao: 'QUALQUER_UM_ATENDE' | 'TODOS_SAO_EXIGIDOS'
  publicoAlvo: 'REQUERENTE' | 'TODAS_AS_PESSOAS_DA_ARVORE'
  condicoes: { combinador: 'TODAS' | 'QUALQUER'; regras: { campo: string; operador: string; valor: unknown }[] } | null
}

// As SEIS regras. Note que nenhuma cita pai, mãe, avô ou geração.
const REGRAS: RegraSpec[] = [
  {
    codigo: 'GEN-REQ-IDENT', nome: 'Identificação do requerente adulto',
    requisito: 'Documento de identificação', documentTypeCode: 'RG',
    // GRUPO ALTERNATIVO canônico: um requisito, duas opções, satisfeito por qualquer uma.
    documentosAceitos: ['RG', 'CNH'], modoSatisfacao: 'QUALQUER_UM_ATENDE',
    publicoAlvo: 'REQUERENTE',
    condicoes: { combinador: 'TODAS', regras: [{ campo: 'maiorDeIdade', operador: 'igual', valor: true }] },
  },
  {
    codigo: 'GEN-REQ-COMPROV', nome: 'Comprovante de endereço do requerente adulto',
    requisito: 'Comprovante de Endereço', documentTypeCode: 'COMP-RES',
    documentosAceitos: ['COMP-RES'], modoSatisfacao: 'TODOS_SAO_EXIGIDOS',
    publicoAlvo: 'REQUERENTE',
    condicoes: { combinador: 'TODAS', regras: [{ campo: 'maiorDeIdade', operador: 'igual', valor: true }] },
  },
  {
    codigo: 'GEN-REQ-PROC', nome: 'Procuração administrativa do requerente adulto',
    requisito: 'Procuração Administrativa', documentTypeCode: 'OUTRO',
    documentosAceitos: ['OUTRO'], modoSatisfacao: 'TODOS_SAO_EXIGIDOS',
    publicoAlvo: 'REQUERENTE',
    condicoes: { combinador: 'TODAS', regras: [{ campo: 'maiorDeIdade', operador: 'igual', valor: true }] },
  },
  {
    codigo: 'GEN-CIVIL-NASC', nome: 'Certidão de nascimento de toda pessoa da árvore',
    requisito: 'Certidão de Nascimento', documentTypeCode: 'IT - NAS',
    documentosAceitos: ['IT - NAS'], modoSatisfacao: 'TODOS_SAO_EXIGIDOS',
    publicoAlvo: 'TODAS_AS_PESSOAS_DA_ARVORE',
    condicoes: null, // toda pessoa da árvore — sem condição adicional
  },
  {
    codigo: 'GEN-CIVIL-CAS', nome: 'Certidão de casamento quando aplicável',
    requisito: 'Certidão de Casamento', documentTypeCode: 'IT - CAS',
    documentosAceitos: ['IT - CAS'], modoSatisfacao: 'TODOS_SAO_EXIGIDOS',
    publicoAlvo: 'TODAS_AS_PESSOAS_DA_ARVORE',
    condicoes: { combinador: 'TODAS', regras: [{ campo: 'casado', operador: 'igual', valor: true }] },
  },
  {
    codigo: 'GEN-CIVIL-OBITO', nome: 'Certidão de óbito de pessoa falecida',
    requisito: 'Certidão de Óbito', documentTypeCode: 'IT - OBI',
    documentosAceitos: ['IT - OBI'], modoSatisfacao: 'TODOS_SAO_EXIGIDOS',
    publicoAlvo: 'TODAS_AS_PESSOAS_DA_ARVORE',
    condicoes: { combinador: 'TODAS', regras: [{ campo: 'falecido', operador: 'igual', valor: true }] },
  },
]

async function main() {
  console.log(`\n== Regras Documentais da Genealogia ${EXECUTAR ? '(EXECUTANDO)' : '(somente relatório)'} ==\n`)
  const log: string[] = []

  // ── 1. POLÍTICA DA FASE ────────────────────────────────────────────────
  const fase = await prisma.catalogoFase.findUnique({ where: { phaseKey: FASE }, select: { id: true } })
  if (!fase) { console.error(`fase "${FASE}" não existe no Catálogo de Fases`); return }
  const naturezas = await prisma.naturezaOperacionalDocumento.findMany({ where: { code: { in: NATUREZAS_DA_FASE } }, select: { id: true, code: true, name: true } })
  for (const n of naturezas) {
    const ja = await prisma.faseNaturezaPermitida.findUnique({ where: { catalogoFaseId_naturezaOperacionalId: { catalogoFaseId: fase.id, naturezaOperacionalId: n.id } } })
    if (ja) { log.push(`  = natureza já habilitada: ${n.name}`); continue }
    if (EXECUTAR) await prisma.faseNaturezaPermitida.create({ data: { catalogoFaseId: fase.id, naturezaOperacionalId: n.id } })
    log.push(`  + natureza habilitada na Genealogia: ${n.name}`)
  }
  const faltando = NATUREZAS_DA_FASE.filter((c) => !naturezas.some((n) => n.code === c))
  for (const c of faltando) log.push(`  ! natureza "${c}" não existe no cadastro`)

  // ── 2. FAMÍLIA "COMPROVANTE" (não existia) ─────────────────────────────
  let comprovante = await prisma.familiaDocumental.findUnique({ where: { code: 'COMPROVANTE' } })
  if (!comprovante) {
    if (EXECUTAR) comprovante = await prisma.familiaDocumental.create({ data: { code: 'COMPROVANTE', name: 'Comprovante', descricao: 'Comprovantes apresentados pelo cliente (endereço, renda, vínculo).', ordem: 5 } })
    log.push('  + família documental criada: Comprovante')
  }

  // ── 3. VÍNCULOS DOS TIPOS DOCUMENTAIS ──────────────────────────────────
  for (const v of VINCULOS) {
    const tipo = await prisma.tipoDocumentoCadastro.findFirst({ where: { code: v.code } })
    if (!tipo) { log.push(`  ! tipo documental "${v.code}" não existe`); continue }
    const fam = await prisma.familiaDocumental.findUnique({ where: { code: v.familia } })
    const nat = await prisma.naturezaOperacionalDocumento.findUnique({ where: { code: v.natureza } })
    const cat = await prisma.categoriaDocumental.findUnique({ where: { code: v.categoria } })
    let item = await prisma.itemCatalogo.findUnique({ where: { code: v.item.code } })
    // `ItemCatalogo.categoriaId` é categoria de SERVIÇO, não documental — a
    // classificação documental vive em `TipoDocumentoCadastro.categoriaDocumentalId`.
    if (!item && EXECUTAR) item = await prisma.itemCatalogo.create({ data: { code: v.item.code, name: v.item.name, natureza: 'DOCUMENTO', unidade: 'DOCUMENTO', ativo: true } })
    if (EXECUTAR && (fam || nat || item)) {
      await prisma.tipoDocumentoCadastro.update({
        where: { id: tipo.id },
        data: {
          familiaDocumentalId: fam?.id ?? tipo.familiaDocumentalId,
          naturezaOperacionalId: nat?.id ?? tipo.naturezaOperacionalId,
          itemCatalogoId: item?.id ?? tipo.itemCatalogoId,
          categoriaDocumentalId: cat?.id ?? tipo.categoriaDocumentalId,
          // perfilOperacionalId permanece NULL: sem perfil, sem workflow de certidão.
          ativo: true,
        },
      })
    }
    log.push(`  ${tipo.familiaDocumentalId && tipo.naturezaOperacionalId && tipo.itemCatalogoId ? '=' : '+'} ${tipo.name}: família=${v.familia} natureza=${v.natureza} item=${v.item.code} perfil=(nenhum, sem workflow)`)
  }

  // ── 4. AS SEIS REGRAS, PUBLICADAS ──────────────────────────────────────
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ select: { id: true } })
  for (const r of REGRAS) {
    const existente = await prisma.matrizDocumental.findFirst({ where: { codigo: r.codigo } })
    const data = {
      codigo: r.codigo, nome: r.nome, requisitoNome: r.requisito,
      tipoProcessoId: tipos[0]?.id ?? 0, aplicaTodosProcessos: true,
      phaseKey: FASE, faseExigencia: FASE, faseBloqueio: FASE,
      documentTypeCode: r.documentTypeCode,
      documentosAceitos: r.documentosAceitos,
      modoSatisfacao: r.modoSatisfacao as never,
      publicoAlvo: r.publicoAlvo as never,
      condicoes: (r.condicoes ?? undefined) as never,
      obrigatoriedade: 'OBRIGATORIA' as never,
      required: true, createsTask: false, createsCost: false, createsRevenue: false,
      status: 'PUBLICADA' as never, arquivado: false,
      publicadoEm: new Date(),
    }
    if (!EXECUTAR) { log.push(`  ${existente ? '~' : '+'} regra ${r.codigo}: ${r.nome}`); continue }
    if (existente) await prisma.matrizDocumental.update({ where: { id: existente.id }, data })
    else await prisma.matrizDocumental.create({ data })
    log.push(`  ${existente ? '~' : '+'} regra PUBLICADA ${r.codigo}: ${r.nome}`)
  }

  console.log(log.join('\n'))
  console.log(`\n  ${EXECUTAR ? 'aplicado' : 'nada foi escrito — rode com --execute'}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
