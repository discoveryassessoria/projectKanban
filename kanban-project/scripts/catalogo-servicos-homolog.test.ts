// scripts/catalogo-servicos-homolog.test.ts
// ============================================================================
// SMOKE FUNCIONAL (banco) — Catálogo de Serviços como face única do mestre.
// Roda em HOMOLOGAÇÃO (Preview), onde existe banco. Somente rotas de escrita
// que a própria tela usa; tudo o que cria é REMOVIDO no fim, e os totais do
// cadastro voltam ao valor inicial (prova de que nada foi perdido).
//
// Cobre as validações obrigatórias da migração:
//   1. cadastrar item no Catálogo de Serviços (serviço e item técnico);
//   2. editar e inativar item;
//   3. confirmar vínculos existentes (nenhuma FK órfã, nenhum registro perdido);
//   4. Novo Custo / Nova Receita (elegibilidade real do seletor);
//   5. Configurações Financeiras (config única por item, criada e refletida);
//   6. Tabela de Valores intocada (preço não é assunto desta tela);
//   7. documentos e serviços já cadastrados seguem visíveis e sem duplicar.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { NaturezaItem, UnidadeItem } from '@prisma/client'
import { sincronizarItemDeServico } from '@/src/services/catalogo-sync'
import { garantirConfigFinanceiraDeItem, refletirEstadoNaConfigDeServico } from '@/src/services/config-financeira-auto'
import { slugTecnico, gerarChaveUnica } from '@/src/lib/catalogo/chave-tecnica-interna'
import {
  NATUREZAS_ITEM_OFICIAIS, elegibilidadeParaLancamento, hojeISO,
} from '@/lib/financeiro/catalogo-oficial'
import { unificarCatalogo, filtrarCatalogo } from '@/lib/gerenciamento/catalogo-servicos'

let ok = 0, fail = 0
const falhas: string[] = []
const chk = (c: boolean, m: string) => {
  if (c) { ok++; console.log('  ✅', m) } else { fail++; falhas.push(m); console.log('  ❌', m) }
}
const secao = (t: string) => console.log(`\n${t}`)

const NATUREZAS_PRISMA = NATUREZAS_ITEM_OFICIAIS.map((n) => NaturezaItem[n])
const MARCA = 'SMOKE Catálogo de Serviços'

/** Censo do cadastro mestre e de tudo que o referencia. */
async function censo() {
  const [itens, servicos, configs, precos, tiposDoc, tiposServico, necessidades, catsFin] = await Promise.all([
    prisma.itemCatalogo.count(),
    prisma.servicoProduto.count(),
    prisma.produtoFinanceiro.count(),
    prisma.tabelaValor.count(),
    prisma.tipoDocumentoCadastro.count({ where: { itemCatalogoId: { not: null } } }),
    prisma.tipoServico.count({ where: { itemCatalogoId: { not: null } } }),
    prisma.necessidadeDocumental.count(), // itemCatalogoId é obrigatório nesta tabela
    prisma.categoriaFinanceira.count({ where: { itemCatalogoId: { not: null } } }),
  ])
  return { itens, servicos, configs, precos, tiposDoc, tiposServico, necessidades, catsFin }
}

/** Toda FK que aponta para o mestre resolve num ItemCatalogo existente? */
async function fksOrfas(): Promise<string[]> {
  const ids = new Set((await prisma.itemCatalogo.findMany({ select: { id: true } })).map((i) => i.id))
  const orfas: string[] = []
  const conferir = async (rotulo: string, lista: { itemCatalogoId: number | null }[]) => {
    const quebradas = lista.filter((r) => r.itemCatalogoId != null && !ids.has(r.itemCatalogoId)).length
    if (quebradas > 0) orfas.push(`${rotulo}: ${quebradas}`)
  }
  await conferir('ServicoProduto', await prisma.servicoProduto.findMany({ select: { itemCatalogoId: true } }))
  await conferir('ProdutoFinanceiro', await prisma.produtoFinanceiro.findMany({ select: { itemCatalogoId: true } }))
  await conferir('TabelaValor', await prisma.tabelaValor.findMany({ select: { itemCatalogoId: true } }))
  await conferir('TipoDocumentoCadastro', await prisma.tipoDocumentoCadastro.findMany({ select: { itemCatalogoId: true } }))
  await conferir('TipoServico', await prisma.tipoServico.findMany({ select: { itemCatalogoId: true } }))
  await conferir('NecessidadeDocumental', await prisma.necessidadeDocumental.findMany({ select: { itemCatalogoId: true } }))
  await conferir('CategoriaFinanceira', await prisma.categoriaFinanceira.findMany({ select: { itemCatalogoId: true } }))
  return orfas
}

/** Elegibilidade REAL do seletor de Novo Custo / Nova Receita (mesma regra da rota). */
async function elegiveis(natureza: 'CUSTO' | 'RECEITA'): Promise<Set<number>> {
  const itens = await prisma.itemCatalogo.findMany({
    where: { ativo: true, natureza: { in: NATUREZAS_PRISMA }, produtos: { some: { ativo: true } } },
    select: {
      id: true, natureza: true,
      produtos: { where: { ativo: true }, select: { ativo: true, naturezaFin: true, possuiCusto: true, possuiReceita: true, valorCustoPadrao: true, valorReceitaPadrao: true } },
      precos: { where: { arquivado: false, legadoPendente: false }, select: { natureza: true, arquivado: true, legadoPendente: true, vigenciaInicio: true, vigenciaFim: true } },
    },
  })
  const hoje = hojeISO(new Date())
  return new Set(itens.filter((i) => {
    const cfg = i.produtos[0]
    return elegibilidadeParaLancamento({
      item: { ativo: true, natureza: i.natureza },
      config: cfg && {
        ativo: cfg.ativo, naturezaFin: cfg.naturezaFin, possuiCusto: cfg.possuiCusto, possuiReceita: cfg.possuiReceita,
        valorCustoPadrao: cfg.valorCustoPadrao != null ? Number(cfg.valorCustoPadrao) : null,
        valorReceitaPadrao: cfg.valorReceitaPadrao != null ? Number(cfg.valorReceitaPadrao) : null,
      },
      precos: i.precos,
      natureza,
      hoje,
    }).ok
  }).map((i) => i.id))
}

/** Lista unificada exatamente como a tela monta (mesmos selects dos dois GETs). */
async function listaDaTela() {
  const [servicos, itens] = await Promise.all([
    prisma.servicoProduto.findMany({
      orderBy: { code: 'asc' },
      include: {
        itemCatalogo: {
          select: {
            id: true, natureza: true, unidade: true,
            _count: { select: { tiposDocumento: true, produtos: true, servicos: true, precos: true } },
          },
        },
      },
    }),
    prisma.itemCatalogo.findMany({
      orderBy: [{ natureza: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { tiposDocumento: true, produtos: true, servicos: true, precos: true } } },
    }),
  ])
  return unificarCatalogo({ servicos: servicos as never, itens: itens as never })
}

async function main() {
  console.log('SMOKE — Catálogo de Serviços, face única do Cadastro Mestre (homologação)\n')

  const antes = await censo()
  console.log(`  censo inicial: ${JSON.stringify(antes)}`)
  const orfasAntes = await fksOrfas()
  chk(orfasAntes.length === 0, `nenhuma FK órfã ANTES (${orfasAntes.join('; ') || 'ok'})`)

  // ── 7) documentos e serviços já cadastrados ───────────────────────────────
  secao('7) Documentos e serviços JÁ cadastrados na lista unificada')
  const lista = await listaDaTela()
  const servicosAtivosNoBanco = await prisma.servicoProduto.count()
  chk(lista.filter((l) => l.origem === 'servico').length === servicosAtivosNoBanco,
    `todo serviço cadastrado aparece exatamente uma vez (${servicosAtivosNoBanco})`)
  chk(new Set(lista.map((l) => l.chave)).size === lista.length, 'nenhuma linha duplicada na lista unificada')
  const idsMestre = lista.map((l) => l.itemCatalogoId).filter((v): v is number => v != null)
  chk(new Set(idsMestre).size === idsMestre.length, 'nenhum item do mestre aparece duas vezes (serviço + espelho)')
  const eliminadas = lista.filter((l) => l.natureza === 'PRODUTO' || l.natureza === 'HONORARIO')
  chk(eliminadas.length === 0, 'nenhum item de estrutura eliminada é exibido (dado histórico preservado no banco)')
  const historicos = await prisma.itemCatalogo.count({ where: { natureza: { in: [NaturezaItem.PRODUTO, NaturezaItem.HONORARIO] } } })
  console.log(`     (${historicos} item(ns) histórico(s) PRODUTO/HONORARIO seguem no banco, só fora da tela)`)
  const docs = lista.filter((l) => l.natureza === 'DOCUMENTO')
  chk(docs.length > 0, `documentos do mestre continuam acessíveis na tela oficial (${docs.length})`)
  const relacionados = filtrarCatalogo(lista, { escopo: 'relacionados' })
  const comerciais = filtrarCatalogo(lista, { escopo: 'comercial' })
  chk(relacionados.length + comerciais.length === lista.length, `escopos cobrem o cadastro inteiro (${comerciais.length} comercializáveis + ${relacionados.length} itens cobrados relacionados = ${lista.length})`)
  // Nenhum documento pode aparecer na aba de VENDA.
  chk(comerciais.every((l) => l.natureza !== 'DOCUMENTO'), 'nenhum documento aparece como comercializável')

  // ── 1) cadastrar (serviço) — mesmo caminho do POST da tela ────────────────
  secao('1) Cadastrar item — Serviço')
  const nomeServico = `${MARCA} — Serviço`
  const criado = await prisma.$transaction(async (tx) => {
    const code = await gerarChaveUnica(slugTecnico(nomeServico, 'SERVICO'), async (c) =>
      !!(await tx.servicoProduto.findUnique({ where: { code: c }, select: { id: true } })) ||
      !!(await tx.itemCatalogo.findUnique({ where: { code: c }, select: { id: true } })),
    )
    const itemCatalogoId = await sincronizarItemDeServico(tx, { code, name: nomeServico, categoriaId: null })
    const s = await tx.servicoProduto.create({
      data: { code, name: nomeServico, descricao: 'registro de smoke', aplicacaoGlobal: true, ativo: true, itemCatalogoId },
    })
    const cfg = await garantirConfigFinanceiraDeItem(tx, { itemCatalogoId, nome: nomeServico })
    return { servicoId: s.id, itemCatalogoId, configId: cfg.id, configCriada: cfg.criado }
  })
  chk(criado.servicoId > 0 && criado.itemCatalogoId > 0, `serviço criado (#${criado.servicoId}) com espelho no mestre (#${criado.itemCatalogoId})`)
  const svcSalvo = await prisma.servicoProduto.findUnique({ where: { id: criado.servicoId } })
  chk(!!svcSalvo && svcSalvo.code.length > 0, `chave técnica gerada no backend (o operador não digita identificador: ${svcSalvo?.code})`)
  const espelho = await prisma.itemCatalogo.findUnique({ where: { id: criado.itemCatalogoId } })
  chk(espelho?.natureza === NaturezaItem.SERVICO, 'espelho nasce com natureza SERVICO (nunca PRODUTO)')

  // ── 1b) cadastrar (item técnico) — mesmo caminho do POST do mestre ────────
  secao('1b) Cadastrar item — Taxa (item técnico do mesmo cadastro)')
  const nomeTaxa = `${MARCA} — Taxa`
  const codeTaxa = await gerarChaveUnica(slugTecnico(nomeTaxa, 'ITEM'), async (c) =>
    !!(await prisma.itemCatalogo.findUnique({ where: { code: c }, select: { id: true } })),
  )
  const taxa = await prisma.itemCatalogo.create({
    data: { code: codeTaxa, name: nomeTaxa, natureza: NaturezaItem.TAXA, unidade: UnidadeItem.PROCESSO, ativo: true },
  })
  chk(taxa.id > 0 && taxa.natureza === NaturezaItem.TAXA, `item técnico criado (#${taxa.id}, natureza TAXA, unidade PROCESSO)`)

  const comAmbos = await listaDaTela()
  chk(comAmbos.some((l) => l.origem === 'servico' && l.id === criado.servicoId), 'serviço novo aparece na lista unificada')
  chk(comAmbos.some((l) => l.origem === 'item' && l.id === taxa.id && l.tipo === 'Taxa'), 'item técnico novo aparece com o rótulo de negócio "Taxa"')
  chk(!comAmbos.some((l) => l.origem === 'item' && l.id === criado.itemCatalogoId), 'espelho do serviço NÃO vira segunda linha')
  const linhaTaxa = comAmbos.find((l) => l.id === taxa.id && l.origem === 'item')!
  chk(linhaTaxa.unidade === 'PROCESSO' && linhaTaxa.ativo === true, 'unidade e status do item técnico chegam corretos à tela')

  // ── 5) Configurações Financeiras ─────────────────────────────────────────
  secao('5) Configurações Financeiras')
  chk(criado.configCriada === true, 'serviço nasce com Configuração Financeira (automática, vínculo estrutural)')
  const cfg = await prisma.produtoFinanceiro.findUnique({ where: { itemCatalogoId: criado.itemCatalogoId } })
  chk(!!cfg && cfg.id === criado.configId, 'config resolve pelo itemCatalogoId (uma config por item mestre)')
  const cfgsDoItem = await prisma.produtoFinanceiro.count({ where: { itemCatalogoId: criado.itemCatalogoId } })
  chk(cfgsDoItem === 1, `exatamente uma config para o item (${cfgsDoItem})`)

  // ── 4) Novo Custo / Nova Receita ─────────────────────────────────────────
  secao('4) Novo Custo / Nova Receita (elegibilidade real do seletor)')
  const elegCusto = await elegiveis('CUSTO')
  const elegReceita = await elegiveis('RECEITA')
  chk(elegCusto.has(criado.itemCatalogoId), 'serviço novo está elegível a Novo Custo (custo não exige preço)')
  chk(!elegReceita.has(criado.itemCatalogoId), 'serviço novo NÃO está elegível a Nova Receita sem preço vigente (regra preservada)')
  chk(!elegCusto.has(taxa.id) && !elegReceita.has(taxa.id), 'item técnico sem config não entra no seletor de lançamento')
  const idsEliminados = (await prisma.itemCatalogo.findMany({
    where: { natureza: { in: [NaturezaItem.PRODUTO, NaturezaItem.HONORARIO] } }, select: { id: true },
  })).map((i) => i.id)
  chk(!idsEliminados.some((id) => elegCusto.has(id) || elegReceita.has(id)), 'nenhum item de estrutura eliminada é elegível a lançamento')

  // ── 2) editar e inativar ─────────────────────────────────────────────────
  secao('2) Editar e inativar')
  const nomeEditado = `${MARCA} — Serviço (editado)`
  await prisma.$transaction(async (tx) => {
    const atual = (await tx.servicoProduto.findUnique({ where: { id: criado.servicoId } }))!
    const itemId = await sincronizarItemDeServico(tx, { code: atual.code, name: nomeEditado, categoriaId: null }, atual.itemCatalogoId)
    await tx.servicoProduto.update({ where: { id: criado.servicoId }, data: { name: nomeEditado, itemCatalogoId: itemId } })
    await garantirConfigFinanceiraDeItem(tx, { itemCatalogoId: itemId, nome: nomeEditado })
    await refletirEstadoNaConfigDeServico(tx, { itemCatalogoId: itemId, nome: nomeEditado, ativo: true })
  })
  const editado = await prisma.servicoProduto.findUnique({ where: { id: criado.servicoId } })
  const espelhoEditado = await prisma.itemCatalogo.findUnique({ where: { id: criado.itemCatalogoId } })
  chk(editado?.name === nomeEditado, 'edição do nome persistida no serviço')
  chk(espelhoEditado?.name === nomeEditado, 'edição propagada ao mestre (mesmo id — vínculo preservado)')
  chk(editado?.itemCatalogoId === criado.itemCatalogoId, 'editar NÃO cria novo item mestre (vínculo do Financeiro intacto)')
  chk((await prisma.produtoFinanceiro.count({ where: { itemCatalogoId: criado.itemCatalogoId } })) === 1, 'editar NÃO duplica a Configuração Financeira')

  // inativar (serviço e item técnico) — o caminho da tela é o status, não a exclusão
  await prisma.$transaction(async (tx) => {
    await tx.servicoProduto.update({ where: { id: criado.servicoId }, data: { ativo: false } })
    await refletirEstadoNaConfigDeServico(tx, { itemCatalogoId: criado.itemCatalogoId, nome: nomeEditado, ativo: false })
  })
  await prisma.itemCatalogo.update({ where: { id: taxa.id }, data: { ativo: false } })
  const svcInativo = await prisma.servicoProduto.findUnique({ where: { id: criado.servicoId } })
  const cfgInativa = await prisma.produtoFinanceiro.findUnique({ where: { itemCatalogoId: criado.itemCatalogoId } })
  const taxaInativa = await prisma.itemCatalogo.findUnique({ where: { id: taxa.id } })
  chk(svcInativo?.ativo === false, 'serviço inativado (registro preservado)')
  chk(cfgInativa?.ativo === false, 'Configuração Financeira reflete a inativação')
  chk(taxaInativa?.ativo === false, 'item técnico inativado (registro preservado)')
  const elegCustoPos = await elegiveis('CUSTO')
  chk(!elegCustoPos.has(criado.itemCatalogoId), 'item inativado sai do seletor de lançamento (sem apagar histórico)')
  const listaPosInativar = await listaDaTela()
  chk(listaPosInativar.some((l) => l.origem === 'servico' && l.id === criado.servicoId && !l.ativo), 'item inativado continua visível na tela, marcado Inativo')

  // ── 6) Tabela de Valores intocada ────────────────────────────────────────
  secao('6) Tabela de Valores')
  const precosAgora = await prisma.tabelaValor.count()
  chk(precosAgora === antes.precos, `nenhum preço criado, alterado ou removido (${antes.precos} → ${precosAgora})`)

  // ── 3) vínculos existentes ───────────────────────────────────────────────
  secao('3) Vínculos existentes')
  const orfasDepois = await fksOrfas()
  chk(orfasDepois.length === 0, `nenhuma FK órfã DEPOIS (${orfasDepois.join('; ') || 'ok'})`)
  const meio = await censo()
  chk(meio.tiposDoc === antes.tiposDoc && meio.tiposServico === antes.tiposServico &&
      meio.necessidades === antes.necessidades && meio.catsFin === antes.catsFin,
    'vínculos preexistentes (documentos, tipos de serviço, necessidades, categorias) inalterados')

  // ── limpeza: o smoke não deixa resíduo ───────────────────────────────────
  secao('Limpeza (o cadastro volta ao estado inicial)')
  await prisma.produtoFinanceiro.deleteMany({ where: { itemCatalogoId: criado.itemCatalogoId } })
  await prisma.servicoProduto.delete({ where: { id: criado.servicoId } })
  await prisma.itemCatalogo.delete({ where: { id: criado.itemCatalogoId } })
  await prisma.itemCatalogo.delete({ where: { id: taxa.id } })
  const depois = await censo()
  chk(JSON.stringify(depois) === JSON.stringify(antes), `censo final idêntico ao inicial (${JSON.stringify(depois)})`)
  const orfasFinal = await fksOrfas()
  chk(orfasFinal.length === 0, `nenhuma FK órfã ao final (${orfasFinal.join('; ') || 'ok'})`)

  console.log(`\n${ok} passaram, ${fail} falharam`)
  if (fail > 0) { console.log('FALHAS: ' + falhas.join('; ')); process.exit(1) }
  console.log('Catálogo de Serviços em homologação: validado ✅')
}

main()
  .catch((e) => { console.error('SMOKE ABORTADO:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
