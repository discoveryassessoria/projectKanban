// prisma/pre-cadastro-estrutural.ts
// ============================================================================
// PRÉ-CADASTRO ESTRUTURAL — a estrutura recuperada, sem um único valor inventado.
//
// O QUE ELE CRIA
// --------------
//   ItemCatalogo (serviço)  →  ProdutoFinanceiro (configuração financeira)
//                           →  PhaseEconomicRule (componente da fase, INATIVO)
//
// O QUE ELE NÃO CRIA, DE PROPÓSITO
// --------------------------------
//   • TabelaValor — preço não tem fonte oficial. Criar linha com valor 0 seria
//     dar a um placeholder o status de preço: o motor já descarta valor<=0, e o
//     guard de publicação recusaria de qualquer forma. Uma tabela vazia diz a
//     verdade ("falta o preço"); uma tabela com zero mente ("o preço é zero").
//   • Fornecedor — nenhum cartório, tradutor ou apostilador jamais foi cadastrado
//     em nenhum backup. Inventar um beneficiário de pagamento é o pior tipo de
//     invenção.
//   • MatrizDocumental — QUAIS documentos um processo exige é a decisão de
//     negócio central. As duas regras históricas apontam para um tipo de processo
//     que não existe mais; mapeá-las seria adivinhação.
//
// POR QUE OS COMPONENTES NASCEM INATIVOS
// --------------------------------------
// `ativo: false` é a trava que o próprio motor já respeita (ele filtra
// `ativo: true`). O componente existe para ser preenchido e ligado pela tela,
// não para gerar lançamento no instante em que é criado.
//
// FONTE DOS NOMES
// ---------------
// Os cinco componentes e as oito configurações vêm do cadastro real de julho,
// recuperado de `discovery-INCIDENTE-forense-20260714T204750.dump`. Não são
// nomes inventados: são os nomes que o sistema já teve. Ver
// docs/system-audit/05-parametrizacao.md §4.
//
// Idempotente: rodar duas vezes não duplica nada.
//
//   npx tsx prisma/pre-cadastro-estrutural.ts            # relatório (não escreve)
//   npx tsx prisma/pre-cadastro-estrutural.ts --execute  # cria o que falta
// ============================================================================

import { prisma } from '@/lib/prisma'

const EXECUTAR = process.argv.includes('--execute')

/**
 * Serviço documental + o componente econômico que ele representa numa fase.
 * `fase` é a phaseKey canônica do catálogo publicado (ver MacroWorkflow).
 */
interface Componente {
  /** code do ItemCatalogo (Cadastro Mestre de Serviços) */
  servicoCode: string
  nome: string
  /** phaseKey canônica em que este componente é produzido */
  fase: string
  /** identidade estrutural do componente dentro da fase */
  componentKey: string
  /** unidade de cobrança conhecida pela natureza do serviço */
  unidade: 'DOCUMENTO' | 'REQUERENTE' | 'PROCESSO'
  /** o serviço tem custo (pagamos alguém)? */
  temCusto: boolean
  /** o serviço é vendido ao cliente? — quando não se sabe, fica true e a
   *  configuração de receita nasce; sem preço ela não gera nada. */
  temReceita: boolean
}

// Os cinco componentes RECUPERADOS do cadastro de julho (§4 do 05-parametrizacao),
// mais os serviços que o programa nomeia como determinísticos da arquitetura e
// que já têm fase canônica publicada para recebê-los.
const COMPONENTES: Componente[] = [
  // — recuperados de PhaseEconomicRule (backup 14/07) —
  { servicoCode: 'SRV_EMISSAO_CERTIDAO', nome: 'Emissão de Certidão', fase: 'emissao_documental', componentKey: 'EMISSAO_CERTIDAO', unidade: 'DOCUMENTO', temCusto: true, temReceita: true },
  { servicoCode: 'SRV_TRADUCAO_JURAMENTADA', nome: 'Tradução Juramentada', fase: 'traducao', componentKey: 'TRADUCAO_JURAMENTADA', unidade: 'DOCUMENTO', temCusto: true, temReceita: true },
  { servicoCode: 'SRV_APOSTILAMENTO_CERTIDAO', nome: 'Apostilamento de Certidão', fase: 'apostilamento', componentKey: 'APOSTILAMENTO_CERTIDAO', unidade: 'DOCUMENTO', temCusto: true, temReceita: true },
  { servicoCode: 'SRV_APOSTILAMENTO_TRADUCAO', nome: 'Apostilamento de Tradução', fase: 'apostilamento', componentKey: 'APOSTILAMENTO_TRADUCAO', unidade: 'DOCUMENTO', temCusto: true, temReceita: true },
  { servicoCode: 'SRV_RETIFICACAO_REGISTRO', nome: 'Retificação de Registro', fase: 'retificacao', componentKey: 'RETIFICACAO_REGISTRO', unidade: 'DOCUMENTO', temCusto: true, temReceita: true },
  // — serviço da fase de Genealogia: o passo registral já existe e é canônico —
  { servicoCode: 'SRV_LOCALIZACAO_REGISTRAL', nome: 'Localização de Registro', fase: 'genealogia', componentKey: 'LOCALIZACAO_REGISTRAL', unidade: 'DOCUMENTO', temCusto: true, temReceita: true },
]

interface Resultado {
  servicosCriados: string[]
  servicosReutilizados: string[]
  configsCriadas: string[]
  configsReutilizadas: string[]
  componentesCriados: string[]
  componentesReutilizados: string[]
  fasesInexistentes: string[]
}

async function main() {
  const r: Resultado = {
    servicosCriados: [], servicosReutilizados: [], configsCriadas: [], configsReutilizadas: [],
    componentesCriados: [], componentesReutilizados: [], fasesInexistentes: [],
  }

  // As fases têm de existir no catálogo PUBLICADO — não se cadastra componente
  // para uma fase que o motor não conhece.
  const fasesPublicadas = new Set(
    (await prisma.faseMacro.findMany({ select: { phaseKey: true } })).map((f) => f.phaseKey),
  )

  for (const c of COMPONENTES) {
    if (!fasesPublicadas.has(c.fase)) {
      r.fasesInexistentes.push(`${c.nome} → fase "${c.fase}" não existe no catálogo`)
      continue
    }

    // ── 1. SERVIÇO no Cadastro Mestre ──────────────────────────────────────
    let item = await prisma.itemCatalogo.findUnique({ where: { code: c.servicoCode } })
    if (item) r.servicosReutilizados.push(c.servicoCode)
    else if (EXECUTAR) {
      item = await prisma.itemCatalogo.create({
        data: { code: c.servicoCode, name: c.nome, natureza: 'SERVICO', unidade: c.unidade, ativo: true },
      })
      r.servicosCriados.push(c.servicoCode)
    } else { r.servicosCriados.push(c.servicoCode); continue }

    // ── 2. CONFIGURAÇÃO FINANCEIRA (custo e receita são independentes) ──────
    // `itemCatalogoId` é @unique: uma configuração por item do catálogo. O papel
    // (custo/receita) vive na natureza do PREÇO, não numa segunda configuração —
    // é a regra "config financeira única" já vigente.
    let cfg = await prisma.produtoFinanceiro.findUnique({ where: { itemCatalogoId: item.id } })
    if (cfg) r.configsReutilizadas.push(c.servicoCode)
    else if (EXECUTAR) {
      cfg = await prisma.produtoFinanceiro.create({
        data: {
          codigo: `CFG_${c.componentKey}`.slice(0, 30), nome: c.nome,
          itemCatalogoId: item.id, ativo: true,
          // SEM moedaPadrao, SEM fornecedorPadraoId, SEM política: são decisões
          // comerciais. A pendência nomeia cada uma delas.
        },
      })
      r.configsCriadas.push(c.servicoCode)
    } else { r.configsCriadas.push(c.servicoCode); continue }

    // ── 3. COMPONENTE ECONÔMICO DA FASE — INATIVO ──────────────────────────
    const existente = await prisma.phaseEconomicRule.findFirst({
      where: { phaseKey: c.fase, componentKey: c.componentKey },
    })
    if (existente) { r.componentesReutilizados.push(c.componentKey); continue }
    if (!EXECUTAR) { r.componentesCriados.push(c.componentKey); continue }
    await prisma.phaseEconomicRule.create({
      data: {
        tipoProcessoId: null,          // vale para qualquer tipo até que se decida o contrário
        phaseKey: c.fase,
        documentTypeCode: null,        // qual tipo documental produz o componente é decisão de negócio
        componentKey: c.componentKey,
        componentName: c.nome,
        custoConfigId: c.temCusto ? cfg.id : null,
        receitaConfigId: c.temReceita ? cfg.id : null,
        participaPlanilha: true,
        ordem: COMPONENTES.indexOf(c),
        ativo: false,                  // ⟵ A TRAVA: o motor filtra `ativo: true`
      },
    })
    r.componentesCriados.push(c.componentKey)
  }

  const linha = (t: string, xs: string[]) => console.log(`  ${t.padEnd(26)} ${xs.length}${xs.length ? ' → ' + xs.join(', ') : ''}`)
  console.log(`\n== Pré-cadastro estrutural ${EXECUTAR ? '(EXECUTANDO)' : '(somente relatório)'} ==\n`)
  linha('serviços criados', r.servicosCriados)
  linha('serviços reutilizados', r.servicosReutilizados)
  linha('configurações criadas', r.configsCriadas)
  linha('configurações reutilizadas', r.configsReutilizadas)
  linha('componentes criados', r.componentesCriados)
  linha('componentes reutilizados', r.componentesReutilizados)
  if (r.fasesInexistentes.length) linha('fases inexistentes', r.fasesInexistentes)
  console.log('\n  NENHUM preço, fornecedor ou regra de Matriz foi criado — não há fonte oficial.')
  console.log('  Todos os componentes nascem INATIVOS: não geram custo nem receita.')
  if (!EXECUTAR) console.log('\n  Rode com --execute para criar.')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
