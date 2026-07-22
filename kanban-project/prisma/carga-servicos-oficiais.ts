// prisma/carga-servicos-oficiais.ts
// ============================================================================
// CARGA OFICIAL — 4 serviços comerciais + valores, na estrutura oficial:
//   ItemCatalogo (mestre) → ProdutoFinanceiro (config) → TabelaValor (preço).
//
// IDEMPOTENTE e TRANSACIONAL. Reexecutável sem duplicar. Preserva IDs, vínculos
// e histórico. Preço divergente → arquiva a vigência anterior e cria a nova
// (sem apagar histórico). NÃO cria lançamento, parcela, automação nem roda o
// FinanceRuleEngine — só cadastro e valores.
//
// Aplicabilidade por nacionalidade (ISO/nacionalidade/fase/estratégia) fica no
// campo oficial ItemCatalogo.metadata — não há TipoProcessoNacionalidade para
// todas as nacionalidades (Italiana ausente) e criá-lo estaria fora do escopo.
//
// Uso: DIRECT_DATABASE_URL=<prod> npx tsx prisma/carga-servicos-oficiais.ts [--dry-run]
// ============================================================================
import { prisma } from '@/lib/prisma'
import { NaturezaItem, UnidadeItem, NaturezaFinanceira, NaturezaPreco, Moeda } from '@prisma/client'

const DRY = process.argv.includes('--dry-run')
const HOJE = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

interface ServicoCarga {
  code: string
  nome: string
  categoria: string
  natureza: NaturezaItem
  unidadeItem: UnidadeItem
  estrategia: string
  modoCalculo: 'per_applicant' | 'per_document'
  moeda: Moeda
  // per_applicant: base + adicional; per_document: valorUnitario
  valorBase?: number
  valorAdicional?: number
  valorUnitario?: number
  unidadeTabela: string
  metadata: Record<string, unknown>
}

const SERVICOS: ServicoCarga[] = [
  {
    code: 'SERV-NAC-ITA', nome: 'Assessoria para Nacionalidade Italiana', categoria: 'NACIONALIDADE',
    natureza: NaturezaItem.SERVICO, unidadeItem: UnidadeItem.REQUERENTE,
    estrategia: 'PRIMEIRO_REQUERENTE_E_ADICIONAIS', modoCalculo: 'per_applicant', moeda: Moeda.EUR,
    valorBase: 6800, valorAdicional: 1800, unidadeTabela: 'requerente',
    metadata: { nacionalidade: 'Italiana', iso: 'ITA', estrategiaCobranca: 'PRIMEIRO_REQUERENTE_E_ADICIONAIS', unidadeCobranca: 'REQUERENTE', faseReferencia: 'Genealogia', permiteLancamentoManual: true, permiteGeracaoAutomatica: true },
  },
  {
    code: 'SERV-NAC-DEU', nome: 'Assessoria para Nacionalidade Alemã', categoria: 'NACIONALIDADE',
    natureza: NaturezaItem.SERVICO, unidadeItem: UnidadeItem.REQUERENTE,
    estrategia: 'PRIMEIRO_REQUERENTE_E_ADICIONAIS', modoCalculo: 'per_applicant', moeda: Moeda.EUR,
    valorBase: 2800, valorAdicional: 1800, unidadeTabela: 'requerente',
    metadata: { nacionalidade: 'Alemã', iso: 'DEU', estrategiaCobranca: 'PRIMEIRO_REQUERENTE_E_ADICIONAIS', unidadeCobranca: 'REQUERENTE', faseReferencia: 'Genealogia', permiteLancamentoManual: true, permiteGeracaoAutomatica: true },
  },
  {
    code: 'SERV-NAC-ESP', nome: 'Assessoria para Nacionalidade Espanhola', categoria: 'NACIONALIDADE',
    natureza: NaturezaItem.SERVICO, unidadeItem: UnidadeItem.REQUERENTE,
    estrategia: 'PRIMEIRO_REQUERENTE_E_ADICIONAIS', modoCalculo: 'per_applicant', moeda: Moeda.EUR,
    valorBase: 2800, valorAdicional: 2000, unidadeTabela: 'requerente',
    metadata: { nacionalidade: 'Espanhola', iso: 'ESP', estrategiaCobranca: 'PRIMEIRO_REQUERENTE_E_ADICIONAIS', unidadeCobranca: 'REQUERENTE', faseReferencia: 'Genealogia', permiteLancamentoManual: true, permiteGeracaoAutomatica: true },
  },
  {
    code: 'SERV-TRANSCRICAO', nome: 'Transcrição de Registro Civil', categoria: 'SERVICO_DOCUMENTAL',
    natureza: NaturezaItem.SERVICO, unidadeItem: UnidadeItem.DOCUMENTO,
    estrategia: 'POR_DOCUMENTO', modoCalculo: 'per_document', moeda: Moeda.EUR,
    valorUnitario: 321, unidadeTabela: 'documento',
    metadata: {
      estrategiaCobranca: 'POR_DOCUMENTO', unidadeCobranca: 'CERTIDAO_ELEGIVEL', faseReferencia: 'Transcrição',
      permiteLancamentoManual: true, permiteGeracaoAutomatica: true,
      // critérios da FUTURA regra automática — registrados em campo oficial de metadados.
      criteriosElegibilidade: { tiposCertidao: ['nascimento', 'casamento', 'obito'], sujeitos: ['requerente_maior', 'requerente_menor'] },
    },
  },
]

const rel = { itens: 0, itensUpd: 0, produtos: 0, produtosUpd: 0, precos: 0, precosUpd: 0 }
const igual = (a: unknown, b: unknown) => Number(a ?? 0) === Number(b ?? 0)

async function main() {
  // ── identidade de produção ──
  const tabelas = Number((await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`))[0].n)
  const req = Number((await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int n FROM "Requerente"`))[0].n)
  if (tabelas < 100 || req < 700) { console.error(`[carga] ABORTADO: sem assinatura de produção (${tabelas} tabelas, ${req} requerentes).`); process.exit(1) }
  console.log(`[carga] alvo: ${tabelas} tabelas · ${req} requerentes · vigência=${HOJE}${DRY ? ' · DRY-RUN' : ''}`)

  for (const s of SERVICOS) {
    await prisma.$transaction(async (tx) => {
      // 1) ItemCatalogo (mestre) — idempotente por code
      const itemExist = await tx.itemCatalogo.findFirst({ where: { code: s.code } })
      let itemId: number
      if (itemExist) {
        itemId = itemExist.id
        if (!DRY) await tx.itemCatalogo.update({ where: { id: itemId }, data: { name: s.nome, natureza: s.natureza, categoria: s.categoria, unidade: s.unidadeItem, ativo: true, metadata: s.metadata as never } })
        rel.itensUpd++
      } else {
        const criado = DRY ? { id: -1 } : await tx.itemCatalogo.create({ data: { code: s.code, name: s.nome, natureza: s.natureza, categoria: s.categoria, unidade: s.unidadeItem, ativo: true, metadata: s.metadata as never } })
        itemId = criado.id
        rel.itens++
      }

      // 2) ProdutoFinanceiro (config) — idempotente por codigo/itemCatalogoId. UMA por item.
      const prodExist = await tx.produtoFinanceiro.findFirst({ where: { OR: [{ codigo: s.code }, { itemCatalogoId: itemId > 0 ? itemId : -1 }] } })
      let prodId: number
      const prodData = { codigo: s.code, nome: s.nome, itemCatalogoId: itemId > 0 ? itemId : null, naturezaFin: NaturezaFinanceira.SOMENTE_RECEITA, possuiReceita: true, possuiCusto: false, moedaPadrao: s.moeda, cobravelDoCliente: true, ativo: true }
      if (prodExist) {
        prodId = prodExist.id
        if (!DRY) await tx.produtoFinanceiro.update({ where: { id: prodId }, data: prodData })
        rel.produtosUpd++
      } else {
        const criado = DRY ? { id: -1 } : await tx.produtoFinanceiro.create({ data: prodData })
        prodId = criado.id
        rel.produtos++
      }

      // 3) TabelaValor (preço, fonte única) — idempotente por config+VENDA+não arquivado
      const precoExist = prodId > 0 ? await tx.tabelaValor.findFirst({ where: { configuracaoFinanceiraItemId: prodId, natureza: NaturezaPreco.VENDA, arquivado: false } }) : null
      const precoData = {
        name: s.nome, configuracaoFinanceiraItemId: prodId > 0 ? prodId : null, itemCatalogoId: itemId > 0 ? itemId : null,
        natureza: NaturezaPreco.VENDA, moeda: s.moeda, modoCalculo: s.modoCalculo, unidade: s.unidadeTabela,
        valor: s.valorUnitario ?? s.valorBase ?? 0, valorBase: s.valorBase ?? null, valorAdicional: s.valorAdicional ?? null,
        vigenciaInicio: HOJE, arquivado: false, prioridade: 0,
      }
      const mesmoValor = precoExist && igual(precoExist.valor, precoData.valor) && igual(precoExist.valorBase, precoData.valorBase) && igual(precoExist.valorAdicional, precoData.valorAdicional) && precoExist.modoCalculo === precoData.modoCalculo
      if (precoExist && mesmoValor) {
        // já vigente e idêntico → nada (idempotente)
      } else if (precoExist && !mesmoValor) {
        // divergente → encerra a vigência anterior (histórico preservado) e cria nova
        if (!DRY) {
          await tx.tabelaValor.update({ where: { id: precoExist.id }, data: { arquivado: true, vigenciaFim: HOJE } })
          await tx.tabelaValor.create({ data: precoData })
        }
        rel.precosUpd++
      } else {
        if (!DRY && prodId > 0) await tx.tabelaValor.create({ data: precoData })
        rel.precos++
      }
    }, { timeout: 30000, maxWait: 10000 })
    console.log(`[carga] ${DRY ? '(dry) ' : ''}${s.code} — ${s.nome} · ${s.modoCalculo} · ${s.valorBase ? `${s.valorBase}+${s.valorAdicional}` : s.valorUnitario} ${s.moeda}`)
  }

  console.log(`[carga] RESULTADO — ItemCatalogo: ${rel.itens} inseridos, ${rel.itensUpd} atualizados · ProdutoFinanceiro: ${rel.produtos} inseridos, ${rel.produtosUpd} reutilizados · TabelaValor: ${rel.precos} inseridas, ${rel.precosUpd} nova(s) vigência(s)`)
  console.log('[carga] OK.')
}

main().catch((e) => { console.error('[carga] ERRO:', e); process.exit(1) }).finally(() => prisma.$disconnect())
