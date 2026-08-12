// lib/financeiro/leitura/planilha-colunas.ts
// ============================================================================
// COLUNAS DA PLANILHA DOCUMENTAL — configuração, e nada além disso.
//
// A Planilha é PROJEÇÃO. A única coisa que pertence a ela é a escolha de QUAIS
// itens do cadastro canônico aparecem como coluna, em que ORDEM e se estão
// ATIVOS. Preço, serviço, documento e fornecedor continuam onde sempre estiveram.
//
// ─── O QUE ESTE MÓDULO SUBSTITUI ────────────────────────────────────────────
// A versão anterior derivava as colunas casando `PhaseEconomicRule.componentName`
// com `TipoServico.nome` — por igualdade de TEXTO. Renomear o serviço no cadastro
// fazia a coluna desaparecer da planilha, sem erro e sem aviso. A âncora agora é
// ID: `ProdutoFinanceiro` (a Configuração Financeira, que é exatamente o que o
// resolvedor de preço recebe) ou `TipoDocumentoCadastro`.
//
// ─── O QUE NÃO ESTÁ AQUI, DE PROPÓSITO ──────────────────────────────────────
// valor · moeda · fornecedor · vigência. Tudo isso vive em `TabelaValor` e é
// resolvido na leitura. Uma coluna que guardasse preço seria a segunda fonte da
// verdade que este desenho existe para impedir.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { ehEstrategia, type EstrategiaColuna } from './planilha-matriz'

export type OrigemColuna = 'SERVICO' | 'DOCUMENTO'

export interface ColunaConfigurada {
  id: number
  origem: OrigemColuna
  /** Como a célula descobre o item canônico: item fixo ou item da linha. */
  estrategia: EstrategiaColuna
  /** Categoria do catálogo que delimita a coluna ITEM_DO_REGISTRO. */
  categoriaItemId: number | null
  categoriaItemNome: string | null
  /** ProdutoFinanceiro.id — o que `resolverPrecoPorConfigDB` recebe. */
  configId: number | null
  /** TipoDocumentoCadastro.id. */
  tipoDocumentoId: number | null
  posicao: number
  ativa: boolean
  /** Nome exibido: `rotuloOverride` quando houver, senão o nome canônico. */
  rotulo: string
  /** O nome como está no cadastro mestre — para o editor mostrar a origem real. */
  rotuloCanonico: string
  rotuloOverride: string | null
}

/**
 * As colunas configuradas. `apenasAtivas` é o que a planilha consome; o editor
 * pede todas, para poder reativar o que foi escondido.
 *
 * Coluna cujo item canônico foi apagado sai da lista sozinha — a FK é `Cascade`.
 */
export async function listarColunasConfiguradas(
  opts: { apenasAtivas?: boolean } = {},
): Promise<ColunaConfigurada[]> {
  const linhas = await prisma.planilhaDocumentalColuna.findMany({
    where: opts.apenasAtivas ? { ativa: true } : {},
    orderBy: [{ posicao: 'asc' }, { id: 'asc' }],
    select: {
      id: true, origem: true, configId: true, tipoDocumentoId: true,
      posicao: true, ativa: true, rotuloOverride: true,
      estrategia: true, categoriaItemId: true,
      config: { select: { nome: true } },
      tipoDocumento: { select: { name: true } },
      categoriaItem: { select: { nome: true } },
    },
  })

  return linhas.map((l) => {
    // Coluna ITEM_DO_REGISTRO não tem item próprio — o nome canônico dela é o da
    // CATEGORIA que a delimita, porque é isso que ela representa: a etapa, não
    // um documento. Cair no rótulo de um item aqui recriaria a confusão entre as
    // duas dimensões.
    const canonico =
      l.estrategia === 'ITEM_DO_REGISTRO'
        ? l.categoriaItem?.nome ?? '(categoria removida do cadastro)'
        : l.config?.nome ?? l.tipoDocumento?.name ?? '(item removido do cadastro)'
    return {
      id: l.id,
      origem: l.origem as OrigemColuna,
      estrategia: ehEstrategia(l.estrategia) ? l.estrategia : 'SERVICO_FIXO',
      categoriaItemId: l.categoriaItemId,
      categoriaItemNome: l.categoriaItem?.nome ?? null,
      configId: l.configId,
      tipoDocumentoId: l.tipoDocumentoId,
      posicao: l.posicao,
      ativa: l.ativa,
      rotulo: (l.rotuloOverride ?? '').trim() || canonico,
      rotuloCanonico: canonico,
      rotuloOverride: l.rotuloOverride,
    }
  })
}

/** Itens do cadastro canônico que ainda podem virar coluna (para o editor). */
export async function listarItensDisponiveis(): Promise<{
  servicos: Array<{ id: number; nome: string; codigo: string; jaEhColuna: boolean }>
  documentos: Array<{ id: number; nome: string; codigo: string | null; jaEhColuna: boolean }>
}> {
  const [configs, tipos, usadas] = await Promise.all([
    prisma.produtoFinanceiro.findMany({
      where: { ativo: true, possuiCusto: true },
      select: { id: true, nome: true, codigo: true },
      orderBy: { nome: 'asc' },
    }),
    prisma.tipoDocumentoCadastro.findMany({
      where: { ativo: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    }),
    prisma.planilhaDocumentalColuna.findMany({ select: { configId: true, tipoDocumentoId: true } }),
  ])
  const configsUsados = new Set(usadas.map((u) => u.configId).filter((v): v is number => v != null))
  const tiposUsados = new Set(usadas.map((u) => u.tipoDocumentoId).filter((v): v is number => v != null))

  return {
    servicos: configs.map((c) => ({ id: c.id, nome: c.nome, codigo: c.codigo, jaEhColuna: configsUsados.has(c.id) })),
    documentos: tipos.map((t) => ({ id: t.id, nome: t.name, codigo: t.code, jaEhColuna: tiposUsados.has(t.id) })),
  }
}

export interface NovaColuna {
  origem: OrigemColuna
  /** ProdutoFinanceiro.id quando SERVICO; TipoDocumentoCadastro.id quando DOCUMENTO. */
  itemId: number
  rotuloOverride?: string | null
}

/**
 * Acrescenta uma coluna. Idempotente por item: pedir duas vezes o mesmo serviço
 * REATIVA a coluna existente em vez de criar uma segunda — o `@unique` no banco
 * é a garantia, este caminho é a cortesia.
 *
 * NÃO cria serviço, não cria documento, não cria preço. Só referencia.
 */
export async function adicionarColuna(nova: NovaColuna): Promise<ColunaConfigurada> {
  const ehServico = nova.origem === 'SERVICO'

  // `itemId` ausente não pode passar daqui. Sem esta guarda o `undefined`
  // atravessa dois `where` do Prisma e vira coringa: `count({ id: undefined })`
  // conta a tabela inteira (logo "o item existe") e
  // `findFirst({ configId: undefined })` casa com a PRIMEIRA coluna que houver —
  // então pedir uma coluna nova ALTERA silenciosamente uma coluna alheia. É
  // exatamente o modo de falha que não dá erro e só aparece na tela do usuário.
  if (!Number.isInteger(nova.itemId) || nova.itemId <= 0) {
    throw new Error(`Coluna da planilha exige o id do item no cadastro; recebido: ${String(nova.itemId)}`)
  }

  // O item PRECISA existir no cadastro canônico. Coluna apontando para o vazio é
  // exatamente o tipo de referência solta que este sistema já pagou caro.
  const existe = ehServico
    ? await prisma.produtoFinanceiro.count({ where: { id: nova.itemId } })
    : await prisma.tipoDocumentoCadastro.count({ where: { id: nova.itemId } })
  if (existe === 0) {
    throw new Error(`${ehServico ? 'Configuração Financeira' : 'Tipo de Documento'} ${nova.itemId} não existe no cadastro.`)
  }

  const chave = ehServico ? { configId: nova.itemId } : { tipoDocumentoId: nova.itemId }
  const jaExiste = await prisma.planilhaDocumentalColuna.findFirst({ where: chave, select: { id: true } })

  const rotulo = (nova.rotuloOverride ?? '').trim() || null
  if (jaExiste) {
    await prisma.planilhaDocumentalColuna.update({
      where: { id: jaExiste.id },
      data: { ativa: true, ...(rotulo !== null ? { rotuloOverride: rotulo } : {}) },
    })
  } else {
    const ultima = await prisma.planilhaDocumentalColuna.aggregate({ _max: { posicao: true } })
    await prisma.planilhaDocumentalColuna.create({
      data: {
        origem: nova.origem,
        configId: ehServico ? nova.itemId : null,
        tipoDocumentoId: ehServico ? null : nova.itemId,
        posicao: (ultima._max.posicao ?? 0) + 1,
        rotuloOverride: rotulo,
      },
    })
  }

  const todas = await listarColunasConfiguradas()
  return todas.find((c) => (ehServico ? c.configId === nova.itemId : c.tipoDocumentoId === nova.itemId))!
}

/**
 * Ativa/inativa. Inativar ESCONDE — não apaga serviço, preço nem custo lançado.
 * Reativar traz o histórico de volta, porque nada dele dependia desta linha.
 */
export async function definirAtiva(id: number, ativa: boolean): Promise<void> {
  await prisma.planilhaDocumentalColuna.update({ where: { id }, data: { ativa } })
}

/** Rótulo curto de apresentação. Não toca no cadastro mestre. */
export async function definirRotulo(id: number, rotulo: string | null): Promise<void> {
  await prisma.planilhaDocumentalColuna.update({
    where: { id },
    data: { rotuloOverride: (rotulo ?? '').trim() || null },
  })
}

/**
 * Reordena. Recebe os ids na ordem desejada e grava a POSIÇÃO — a ordenação
 * nunca é por nome. Em transação: uma reordenação pela metade deixaria a
 * planilha com duas colunas na mesma posição.
 */
export async function reordenarColunas(idsNaOrdem: number[]): Promise<void> {
  await prisma.$transaction(
    idsNaOrdem.map((id, i) =>
      prisma.planilhaDocumentalColuna.update({ where: { id }, data: { posicao: i + 1 } }),
    ),
  )
}

/**
 * COLUNA DE ETAPA — a que resolve o item pela LINHA.
 *
 * É esta a coluna "Certidão Inteiro Teor": ela não aponta para a certidão de
 * nascimento nem para a de casamento, e sim para a CATEGORIA do catálogo a que
 * as três pertencem. Quem escolhe qual delas vale é o registro da linha.
 *
 * Idempotente pela categoria: pedir duas vezes a mesma categoria reativa a
 * coluna que já existe, em vez de criar uma segunda que resolveria as MESMAS
 * células — a duplicidade que o §35 proíbe.
 */
export async function adicionarColunaDeEtapa(args: {
  categoriaItemId: number
  rotuloOverride?: string | null
}): Promise<ColunaConfigurada> {
  if (!Number.isInteger(args.categoriaItemId) || args.categoriaItemId <= 0) {
    throw new Error(`Coluna de etapa exige o id da categoria do catálogo; recebido: ${String(args.categoriaItemId)}`)
  }
  const existe = await prisma.categoriaServico.count({ where: { id: args.categoriaItemId } })
  if (existe === 0) throw new Error(`Categoria ${args.categoriaItemId} não existe no catálogo.`)

  const rotulo = (args.rotuloOverride ?? '').trim() || null
  const ja = await prisma.planilhaDocumentalColuna.findFirst({
    where: { estrategia: 'ITEM_DO_REGISTRO', categoriaItemId: args.categoriaItemId },
    select: { id: true },
  })

  let id: number
  if (ja) {
    await prisma.planilhaDocumentalColuna.update({
      where: { id: ja.id },
      data: { ativa: true, ...(rotulo !== null ? { rotuloOverride: rotulo } : {}) },
    })
    id = ja.id
  } else {
    const ultima = await prisma.planilhaDocumentalColuna.aggregate({ _max: { posicao: true } })
    const criada = await prisma.planilhaDocumentalColuna.create({
      data: {
        origem: 'SERVICO',
        estrategia: 'ITEM_DO_REGISTRO',
        categoriaItemId: args.categoriaItemId,
        configId: null,
        tipoDocumentoId: null,
        posicao: (ultima._max.posicao ?? 0) + 1,
        rotuloOverride: rotulo,
      },
      select: { id: true },
    })
    id = criada.id
  }
  return (await listarColunasConfiguradas()).find((c) => c.id === id)!
}

/** Categorias do catálogo que podem virar coluna de etapa (para o editor). */
export async function listarCategoriasDisponiveis(): Promise<
  Array<{ id: number; nome: string; codigo: string; itens: number; jaEhColuna: boolean }>
> {
  const [cats, usadas] = await Promise.all([
    prisma.categoriaServico.findMany({
      where: { ativo: true },
      select: { id: true, nome: true, code: true, _count: { select: { itens: true } } },
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    }),
    prisma.planilhaDocumentalColuna.findMany({
      where: { estrategia: 'ITEM_DO_REGISTRO' },
      select: { categoriaItemId: true },
    }),
  ])
  const usados = new Set(usadas.map((u) => u.categoriaItemId).filter((v): v is number => v != null))
  return cats.map((c) => ({
    id: c.id, nome: c.nome, codigo: c.code, itens: c._count.itens, jaEhColuna: usados.has(c.id),
  }))
}

/** Remove a coluna da configuração. O item canônico e o histórico permanecem. */
export async function removerColuna(id: number): Promise<void> {
  await prisma.planilhaDocumentalColuna.delete({ where: { id } })
}
