// prisma/carga-servicos-oficiais.ts
// ============================================================================
// CARGA OFICIAL — 4 serviços comerciais + preços, pela MESMA camada oficial da
// tela "Catálogo de Serviços":
//   slugTecnico + gerarChaveUnica  → CÓDIGO gerado automaticamente (nunca hardcoded)
//   sincronizarItemDeServico       → ItemCatalogo (pivô) vinculado
//   garantirConfigFinanceiraDeServico → ProdutoFinanceiro (config) vinculado
//   TabelaValor                    → preço (fonte única) apontando para a config
//
// Serviço mestre = ServicoProduto (o que a tela lista) ↔ ItemCatalogo ↔
// ProdutoFinanceiro ↔ TabelaValor — UM só conceito, ligado por FK. Sem cadastro
// concorrente. IDEMPOTENTE por NOME NORMALIZADO (o código é preservado quando já
// existe). TRANSACIONAL. Reexecutável sem duplicar. Sem lançamento/parcela/
// automação; não roda o FinanceRuleEngine.
//
// LIMPEZA: remove os registros SERV-* de code HARDCODED da carga anterior (sem
// dependência de negócio — 0 Receita/Custo/Necessidade), substituídos aqui pelo
// fluxo oficial de código automático.
//
// Uso: DIRECT_DATABASE_URL=<prod> npx tsx prisma/carga-servicos-oficiais.ts [--dry-run]
// ============================================================================
import { prisma } from '@/lib/prisma'
import { NaturezaFinanceira, NaturezaPreco, Moeda, UnidadeItem } from '@prisma/client'
import { slugTecnico, gerarChaveUnica } from '@/src/lib/catalogo/chave-tecnica-interna'
import { sincronizarItemDeServico } from '@/src/services/catalogo-sync'
import { garantirConfigFinanceiraDeServico } from '@/src/services/config-financeira-auto'

const DRY = process.argv.includes('--dry-run')
const HOJE = new Date().toISOString().slice(0, 10)

interface ServicoCarga {
  nome: string
  categoria: string
  nationality: string
  unidadeItem: UnidadeItem
  modoCalculo: 'per_applicant' | 'per_document'
  moeda: Moeda
  valorBase?: number
  valorAdicional?: number
  valorUnitario?: number
  unidadeTabela: string
  metadata: Record<string, unknown>
}

const SERVICOS: ServicoCarga[] = [
  {
    nome: 'Assessoria para Nacionalidade Italiana', categoria: 'NACIONALIDADE', nationality: 'italiana',
    unidadeItem: UnidadeItem.REQUERENTE, modoCalculo: 'per_applicant', moeda: Moeda.EUR,
    valorBase: 6800, valorAdicional: 1800, unidadeTabela: 'requerente',
    metadata: { nacionalidade: 'Italiana', iso: 'ITA', estrategiaCobranca: 'PRIMEIRO_REQUERENTE_E_ADICIONAIS', unidadeCobranca: 'REQUERENTE', faseReferencia: 'Genealogia', permiteLancamentoManual: true, permiteGeracaoAutomatica: true },
  },
  {
    nome: 'Assessoria para Nacionalidade Alemã', categoria: 'NACIONALIDADE', nationality: 'alema',
    unidadeItem: UnidadeItem.REQUERENTE, modoCalculo: 'per_applicant', moeda: Moeda.EUR,
    valorBase: 2800, valorAdicional: 1800, unidadeTabela: 'requerente',
    metadata: { nacionalidade: 'Alemã', iso: 'DEU', estrategiaCobranca: 'PRIMEIRO_REQUERENTE_E_ADICIONAIS', unidadeCobranca: 'REQUERENTE', faseReferencia: 'Genealogia', permiteLancamentoManual: true, permiteGeracaoAutomatica: true },
  },
  {
    nome: 'Assessoria para Nacionalidade Espanhola', categoria: 'NACIONALIDADE', nationality: 'espanhola',
    unidadeItem: UnidadeItem.REQUERENTE, modoCalculo: 'per_applicant', moeda: Moeda.EUR,
    valorBase: 2800, valorAdicional: 2000, unidadeTabela: 'requerente',
    metadata: { nacionalidade: 'Espanhola', iso: 'ESP', estrategiaCobranca: 'PRIMEIRO_REQUERENTE_E_ADICIONAIS', unidadeCobranca: 'REQUERENTE', faseReferencia: 'Genealogia', permiteLancamentoManual: true, permiteGeracaoAutomatica: true },
  },
  {
    nome: 'Transcrição de Registro Civil', categoria: 'SERVICO_DOCUMENTAL', nationality: 'all',
    unidadeItem: UnidadeItem.DOCUMENTO, modoCalculo: 'per_document', moeda: Moeda.EUR,
    valorUnitario: 321, unidadeTabela: 'documento',
    metadata: {
      estrategiaCobranca: 'POR_DOCUMENTO', unidadeCobranca: 'CERTIDAO_ELEGIVEL', faseReferencia: 'Transcrição',
      permiteLancamentoManual: true, permiteGeracaoAutomatica: true,
      criteriosElegibilidade: { tiposCertidao: ['nascimento', 'casamento', 'obito'], sujeitos: ['requerente_maior', 'requerente_menor'] },
    },
  },
]

const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const rel = { servicos: 0, servicosUpd: 0, configs: 0, configsReuso: 0, precos: 0, precosUpd: 0, hardcodedRemovidos: 0 }
const eq = (a: unknown, b: unknown) => Number(a ?? 0) === Number(b ?? 0)

async function main() {
  const tabelas = Number((await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`))[0].n)
  const req = Number((await prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int n FROM "Requerente"`))[0].n)
  if (tabelas < 100 || req < 700) { console.error(`[carga] ABORTADO: sem assinatura de produção (${tabelas} tabelas, ${req} requerentes).`); process.exit(1) }
  console.log(`[carga] alvo: ${tabelas} tabelas · ${req} requerentes · vigência=${HOJE}${DRY ? ' · DRY-RUN' : ''}`)

  // ── LIMPEZA dos SERV-* de código HARDCODED (carga anterior; 0 dependência de negócio) ──
  const prodsHard = await prisma.produtoFinanceiro.findMany({ where: { codigo: { startsWith: 'SERV-' } }, select: { id: true } })
  const itensHard = await prisma.itemCatalogo.findMany({ where: { code: { startsWith: 'SERV-' } }, select: { id: true } })
  if (prodsHard.length || itensHard.length) {
    if (!DRY) {
      await prisma.$transaction(async (tx) => {
        await tx.tabelaValor.deleteMany({ where: { configuracaoFinanceiraItemId: { in: prodsHard.map((p) => p.id) } } })
        await tx.tabelaValor.deleteMany({ where: { itemCatalogoId: { in: itensHard.map((i) => i.id) } } })
        await tx.produtoFinanceiro.deleteMany({ where: { id: { in: prodsHard.map((p) => p.id) } } })
        await tx.itemCatalogo.deleteMany({ where: { id: { in: itensHard.map((i) => i.id) } } })
      }, { timeout: 30000, maxWait: 10000 })
    }
    rel.hardcodedRemovidos = itensHard.length
    console.log(`[carga] ${DRY ? '(dry) ' : ''}limpeza: ${itensHard.length} ItemCatalogo + ${prodsHard.length} ProdutoFinanceiro SERV-* (hardcoded) removidos`)
  }

  for (const s of SERVICOS) {
    await prisma.$transaction(async (tx) => {
      // 1) SERVIÇO MESTRE (ServicoProduto) — idempotente por NOME NORMALIZADO.
      const candidatos = await tx.servicoProduto.findMany({ select: { id: true, code: true, name: true, itemCatalogoId: true } })
      const existente = candidatos.find((c) => norm(c.name) === norm(s.nome))

      let itemCatalogoId: number
      if (existente) {
        // CÓDIGO já gerado pelo sistema — preservado integralmente.
        itemCatalogoId = existente.itemCatalogoId ?? (await sincronizarItemDeServico(tx, { code: existente.code, name: s.nome, category: s.categoria }))
        if (!DRY) await tx.servicoProduto.update({ where: { id: existente.id }, data: { name: s.nome, category: s.categoria, nationality: s.nationality, ativo: true, itemCatalogoId, unidadePadrao: null } })
        rel.servicosUpd++
      } else {
        // FLUXO OFICIAL: código gerado automaticamente (nunca hardcoded).
        const code = await gerarChaveUnica(slugTecnico(s.nome, 'SERVICO'), async (c) =>
          !!(await tx.servicoProduto.findUnique({ where: { code: c }, select: { id: true } })) ||
          !!(await tx.itemCatalogo.findUnique({ where: { code: c }, select: { id: true } })),
        )
        itemCatalogoId = await sincronizarItemDeServico(tx, { code, name: s.nome, category: s.categoria })
        if (!DRY) await tx.servicoProduto.create({ data: { code, name: s.nome, category: s.categoria, nationality: s.nationality, ativo: true, itemCatalogoId } })
        rel.servicos++
      }

      // metadata oficial (nacionalidade/ISO/estratégia/critérios) no ItemCatalogo.
      if (!DRY) await tx.itemCatalogo.update({ where: { id: itemCatalogoId }, data: { categoria: s.categoria, metadata: s.metadata as never } })

      // 2) CONFIGURAÇÃO FINANCEIRA (ProdutoFinanceiro) — camada oficial, vinculada ao mestre.
      let configId = -1
      if (!DRY) {
        const cfg = await garantirConfigFinanceiraDeServico(tx, { itemCatalogoId, nome: s.nome })
        configId = cfg.id
        if (cfg.criado) rel.configs++; else rel.configsReuso++
        await tx.produtoFinanceiro.update({ where: { id: configId }, data: { naturezaFin: NaturezaFinanceira.SOMENTE_RECEITA, possuiReceita: true, possuiCusto: false, moedaPadrao: s.moeda, cobravelDoCliente: true, ativo: true } })
      }

      // 3) PREÇO (TabelaValor) — fonte única, apontando para a config. Idempotente por config+VENDA+não arquivado.
      if (!DRY && configId > 0) {
        const precoExist = await tx.tabelaValor.findFirst({ where: { configuracaoFinanceiraItemId: configId, natureza: NaturezaPreco.VENDA, arquivado: false } })
        const precoData = {
          name: s.nome, configuracaoFinanceiraItemId: configId, itemCatalogoId,
          natureza: NaturezaPreco.VENDA, moeda: s.moeda, modoCalculo: s.modoCalculo, unidade: s.unidadeTabela,
          valor: s.valorUnitario ?? s.valorBase ?? 0, valorBase: s.valorBase ?? null, valorAdicional: s.valorAdicional ?? null,
          vigenciaInicio: HOJE, arquivado: false, prioridade: 0,
        }
        const igual = precoExist && eq(precoExist.valor, precoData.valor) && eq(precoExist.valorBase, precoData.valorBase) && eq(precoExist.valorAdicional, precoData.valorAdicional) && precoExist.modoCalculo === precoData.modoCalculo
        if (precoExist && igual) {
          // idempotente — nada
        } else if (precoExist) {
          await tx.tabelaValor.update({ where: { id: precoExist.id }, data: { arquivado: true, vigenciaFim: HOJE } })
          await tx.tabelaValor.create({ data: precoData })
          rel.precosUpd++
        } else {
          await tx.tabelaValor.create({ data: precoData })
          rel.precos++
        }
      } else if (DRY) {
        rel.precos++
      }
    }, { timeout: 30000, maxWait: 10000 })
    console.log(`[carga] ${DRY ? '(dry) ' : ''}${s.nome} · ${s.modoCalculo} · ${s.valorBase ? `${s.valorBase}+${s.valorAdicional}` : s.valorUnitario} ${s.moeda} · código gerado pelo sistema`)
  }

  console.log(`[carga] RESULTADO — ServicoProduto: ${rel.servicos} inseridos, ${rel.servicosUpd} atualizados · Config(ProdutoFinanceiro): ${rel.configs} criadas, ${rel.configsReuso} reutilizadas · TabelaValor: ${rel.precos} inseridas, ${rel.precosUpd} nova(s) vigência(s) · SERV-* hardcoded removidos: ${rel.hardcodedRemovidos}`)
  console.log('[carga] OK.')
}

main().catch((e) => { console.error('[carga] ERRO:', e); process.exit(1) }).finally(() => prisma.$disconnect())
