// lib/financeiro/leitura/planilha-documental.ts
// ============================================================================
// PLANILHA DOCUMENTAL — projeção econômico-documental. Nunca fonte.
//
// ─── A PLANILHA É UMA MATRIZ ────────────────────────────────────────────────
// LINHA  = registro civil da pessoa (os tipos com `participaPlanilha`)
// COLUNA = etapa/serviço documental (certidão inteiro teor, apostilamento…)
// CÉLULA = a interseção: o item canônico que aquela etapa produz sobre aquele
//          registro (ver `planilha-matriz.ts`) e o preço dele.
//
// Ela não guarda nada e não decide nada:
//
//   quem aparece   → Árvore (pessoas ATIVAS) e Documento
//   o que aplica   → resolverElegibilidadeDocumental (Matriz + Regra Econômica)
//   quanto custa   → resolverPrecoPorConfigDB (Tabela de Preços)
//   o que virou fato → ObrigacaoEconomica (preço CONGELADO no lançamento)
//
// ─── O DEFEITO QUE ESTA VERSÃO CORRIGE ──────────────────────────────────────
// A anterior só sabia somar obrigação JÁ LANÇADA. Documento sem lançamento dava
// R$ 0,00 — e R$ 0,00 é um preço válido, então a planilha dizia "custa zero"
// quando queria dizer "ainda não sei". Não havia previsão: para ver o custo era
// preciso ir ao Financeiro criar o lançamento à mão.
//
// Agora cada célula tem ESTADO, e o número só aparece quando significa algo:
//
//   NAO_APLICAVEL  —            a regra não manda esta etapa para este registro
//   SEM_PRECO      Sem valor    aplicável, mas a Tabela de Preços não resolve
//   AMBIGUO        —            duas configurações disputam a interseção
//   PREVISTO       R$ x         aplicável, preço vigente resolvido (projeção)
//   SOBRESCRITO    R$ x         combinado DESTE processo (não altera a Tabela)
//   REALIZADO      R$ x         virou obrigação — valor CONGELADO, não recalcula
//
// ─── PREVISTO RECALCULA, REALIZADO NÃO ──────────────────────────────────────
// Enquanto é projeção, a célula lê a tabela vigente e acompanha qualquer
// mudança de preço. Quando vira fato, o valor exibido passa a ser o da
// obrigação — congelado no instante do lançamento. Mudar a tabela amanhã não
// reescreve o que foi cobrado ontem.
//
// ─── DESEMPENHO ─────────────────────────────────────────────────────────────
// Nada é consultado por célula. A interseção (coluna × registro) é resolvida
// uma vez para a planilha toda; o preço, uma vez por configuração distinta; os
// combinados, numa consulta só. Um processo com 100 pessoas, 3 registros e 8
// colunas resolve 24 interseções e ~8 preços — não 2.400 consultas.
// ============================================================================

import { prisma } from '@/lib/prisma'
import { NaturezaPreco } from '@prisma/client'
import { listarObrigacoes, type ObrigacaoLista } from './consultas'
import { ehAutomatico } from '../dominio/origem-lancamento'
import { listarColunasConfiguradas, type ColunaConfigurada } from './planilha-colunas'
import { resolverElegibilidadeDocumental } from '@/src/lib/motor/elegibilidade-documental'
import { resolverPrecoPorConfigDB } from '@/src/lib/motor/resolver-preco-financeiro.prisma'
import { pessoasAtivasDaArvore } from '@/src/lib/genealogia/vinculo-ativo'
import { montarPessoasDoProcesso } from '@/src/lib/process-stage/central-operacional-core'
import {
  resolverIntersecao, chaveDaCelula,
  type ColunaMatriz, type ConfigCandidata, type ResolucaoMatriz,
} from './planilha-matriz'
import { overridesDoProcesso } from '../planilha-celula-override'

// ── DINHEIRO EM CENTAVOS ────────────────────────────────────────────────────
// Soma de dinheiro não se faz em float: 146.24 + 7.64 + 151.05 já erra o
// centavo em binário. Acumula-se em inteiro e converte-se na saída.
const paraCentavos = (v: unknown): number => Math.round(Number(v ?? 0) * 100)
const paraReais = (centavos: number): number => Math.round(centavos) / 100

/**
 * O QUE A CÉLULA SABE. Cada estado diz uma coisa que R$ 0,00 não sabe dizer:
 *
 *   NAO_APLICAVEL    a etapa não produz item canônico para este registro
 *   BASE_DISPONIVEL  o item existe e TEM preço, mas a Regra Documental ainda
 *                    não disse se a etapa se aplica aqui
 *   SEM_PRECO        aplicável, mas a Tabela de Preços não resolve
 *   AMBIGUO          duas configurações disputam a interseção — erro de
 *                    cadastro. Escolher uma esconderia o erro dentro de um
 *                    número que parece certo; somar as duas, pior ainda.
 *   PREVISTO         aplicável, preço vigente resolvido
 *   SOBRESCRITO      vale o combinado deste processo, não o preço da tabela
 *   REALIZADO        virou obrigação — valor congelado
 *
 * ─── POR QUE `BASE_DISPONIVEL` EXISTE ───────────────────────────────────────
 * Antes, a célula devolvia NAO_APLICAVEL antes mesmo de olhar o preço. O
 * resultado: R$ 146,24 estava cadastrado, o resolvedor o encontrava, e a
 * planilha exibia "—" — dizendo "não custa nada" quando queria dizer "ainda
 * não sei se aplica".
 *
 * São duas perguntas diferentes: "quanto custa?" é da Tabela de Preços;
 * "incide aqui?" é da Regra Documental. A segunda pode estar sem resposta
 * enquanto a primeira já tem. Esconder o preço por causa disso torna a planilha
 * inútil justamente na fase em que ela mais serve — a de orçar.
 *
 * `BASE_DISPONIVEL` ENTRA nos totais — a planilha é de previsão, e um número
 * visível que não soma quebra a conferência de quem lê. O que ele não faz é
 * gerar lançamento: projetar não é lançar. `totalBaseBrl` diz quanto do total
 * é essa projeção, para o domínio; a tela mostra um total só.
 */
export type EstadoCelula =
  | 'NAO_APLICAVEL' | 'BASE_DISPONIVEL' | 'SEM_PRECO' | 'PREVISTO' | 'REALIZADO' | 'SOBRESCRITO' | 'AMBIGUO'

/** Por que esta célula mostra este número — a resposta do Explain Engine. */
export interface ExplicacaoCelula {
  servico: string
  origem: 'Tabela de Preços' | 'Lançamento realizado (valor congelado)' | 'Combinado deste processo' | null
  tabelaValorId: number | null
  regra: string | null
  moeda: string | null
  /** ids das obrigações que compõem a célula, quando REALIZADO */
  obrigacoes: number[]
  /** motivo textual quando não há valor a mostrar */
  motivo: string | null
  /** O registro desta linha e a etapa desta coluna — a interseção, por extenso. */
  registro: string | null
  /** O item do Cadastro Mestre que a interseção resolveu. Nunca um nome solto. */
  itemResolvidoId: number | null
  itemResolvidoNome: string | null
  /** O preço da Tabela, mesmo quando um combinado passou na frente dele. */
  valorBase: number | null
}

export interface CelulaPlanilha {
  colunaId: number
  /** Preço da Tabela de Preços — continua visível mesmo sob override. */
  valorBase: number | null
  /** Combinado deste processo, quando existir. */
  valorOverride: number | null
  /** `override ?? base` — é este que entra nos totais. */
  valorEfetivo: number | null
  /** A célula aceita edição inline? Só faz sentido onde há etapa aplicável. */
  editavel: boolean
  /** mantido para compatibilidade da resposta legada */
  tipoServicoId: number
  estado: EstadoCelula
  /** valor na moeda do preço/contrato; null quando não há valor */
  valor: number | null
  /** valor em BRL; null quando não há valor */
  valorBrl: number | null
  moeda: string | null
  naoConvertido: number
  automatico: boolean
  obrigacoes: number[]
  explicacao: ExplicacaoCelula
}

/**
 * UMA LINHA = UM TIPO DOCUMENTAL DE UMA PESSOA, não um documento.
 *
 * A planilha de referência mostra SEMPRE as mesmas linhas por pessoa, exista
 * documento ou não — a ausência aparece como "-", nunca como linha faltando. É
 * a leitura de conferência que o operador faz, e uma linha que some esconde
 * justamente o que ele foi ali procurar.
 *
 * Quais linhas são essas quem decide é o Cadastro Mestre, por
 * `TipoDocumentoCadastro.participaPlanilha`, lido POR ID. Hoje isso dá as três
 * certidões de registro civil da referência; se o cadastro declarar uma quarta,
 * ela aparece sozinha, sem tocar em código.
 */
export interface LinhaPlanilha {
  /** 0 quando a linha existe por contrato (tipo declarado, documento ausente). */
  documentoId: number
  /** Cônjuge relevante para ESTA linha (só o casamento costuma ter). */
  conjuge: string | null
  paiNome: string | null
  maeNome: string | null
  pessoaId: number | null
  tipoDocumentoId: number | null
  tipoDocumentoNome: string | null
  tipoRegistro: string | null
  dataRegistro: string | null
  local: string | null
  cartorio: string | null
  livro: string | null
  folha: string | null
  termo: string | null
  numeroRegistro: string | null
  observacao: string | null
  localizado: boolean
  celulas: CelulaPlanilha[]
  totalBrl: number
  naoConvertido: number
}

export interface BlocoPessoa {
  pessoaId: number | null
  nome: string
  numeroLinhagem: number | null
  /** Geração canônica da árvore (1 = topo da linhagem exibida). */
  geracao: number | null
  /** LINHA_PRINCIPAL vai antes; o resto vai para "Fora da linhagem · Cônjuges / Apoio". */
  linhagemPrincipal: boolean
  /** "Requerente", "pai", "bisavó"… — do motor de parentesco, nunca deduzido da geração. */
  posicao: string | null
  conjuges: string[]
  paiNome: string | null
  maeNome: string | null
  linhas: LinhaPlanilha[]
  totalBrl: number
  naoConvertido: number
}

export interface ColunaPlanilha {
  colunaId: number
  tipoServicoId: number
  nome: string
  ordem: number
  origem: string
}

export interface PlanilhaDocumental {
  processoId: number
  colunas: ColunaPlanilha[]
  pessoas: BlocoPessoa[]
  totaisPorServico: Record<number, number>
  totalGeralBrl: number
  totalPrevistoBrl: number
  totalRealizadoBrl: number
  naoConvertido: number
  custosSemVinculo: number
  /**
   * Quanto do total ainda depende de Regra Documental — a parcela em
   * `BASE_DISPONIVEL`. Ela ESTÁ dentro de `totalGeralBrl`: a planilha é de
   * previsão, e valor visível soma. Este número existe para o domínio saber o
   * que é projeção pura, não para dividir a conta na tela.
   */
  totalBaseBrl: number
  /** por que algo não entrou — nunca silêncio (vem do resolvedor de elegibilidade) */
  pendencias: Array<{ motivo: string; detalhe?: string }>
}


const num = (v: unknown): number => (v == null ? 0 : Number(v))
const nomeCompleto = (p: { nome: string; sobrenome: string | null }) =>
  [p.nome, p.sobrenome].filter(Boolean).join(' ').trim()

/** Localizado pela MESMA régua do gate de conclusão: cartório + livro/folha/termo. */
const preenchido = (v: string | null) => !!(v && String(v).trim())
const estaLocalizado = (d: { cartorio: string | null; livro: string | null; folha: string | null; termo: string | null }) =>
  preenchido(d.cartorio) && (preenchido(d.livro) || preenchido(d.folha) || preenchido(d.termo))

/** Preço resolvido de uma coluna, uma vez só. */
interface PrecoDaColuna {
  ok: boolean
  valor: number
  moeda: string | null
  tabelaValorId: number | null
  razao: string
  motivo: string | null
}

export async function montarPlanilhaDocumental(processoId: number): Promise<PlanilhaDocumental> {
  const pendencias: Array<{ motivo: string; detalhe?: string }> = []

  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, arvoreId: true, tipoProcessoMotorId: true },
  })

  // ── 1. COLUNAS — configuração, por ID, nunca por nome ─────────────────────
  const configuradas = await listarColunasConfiguradas({ apenasAtivas: true })
  const colunas: ColunaPlanilha[] = configuradas.map((c, i) => ({
    colunaId: c.id,
    // Compatibilidade da resposta legada: quem consome `tipoServicoId` continua
    // recebendo um número estável por coluna.
    tipoServicoId: c.configId ?? c.tipoDocumentoId ?? c.id,
    nome: c.rotulo,
    ordem: c.posicao || i + 1,
    origem: c.origem,
  }))

  // ── 2. APLICABILIDADE — resolvedor OFICIAL, por fase ──────────────────────
  // Uma coluna existir significa "SE aplicável, mostre aqui". Quem decide se
  // aplica é a Matriz Documental + Regra Econômica, não a configuração da tela.
  const aplicavel = new Map<string, { componente: string }>()
  if (processo?.tipoProcessoMotorId) {
    const fases = await prisma.matrizDocumental.findMany({
      where: { tipoProcessoId: processo.tipoProcessoMotorId, arquivado: false, status: 'PUBLICADA' },
      select: { phaseKey: true }, distinct: ['phaseKey'],
    })
    // SEM REGRA PUBLICADA A PLANILHA NÃO ADIVINHA — e também não fica muda. Toda
    // célula viria "—" e o operador não teria como saber se o serviço não se
    // aplica ou se o cadastro é que está incompleto.
    if (fases.length === 0) {
      pendencias.push({
        motivo: 'nenhuma Regra Documental PUBLICADA para este tipo de processo',
        detalhe: 'sem regra publicada nada é aplicável — publique em Gerenciamento › Regras Documentais',
      })
    }
    for (const { phaseKey } of fases) {
      if (!phaseKey) continue
      const eleg = await resolverElegibilidadeDocumental(processoId, processo.tipoProcessoMotorId, phaseKey, 1)
      pendencias.push(...eleg.pulados)
      for (const item of eleg.itens) {
        if (!item.criaCusto || item.custoConfigId == null) continue
        aplicavel.set(`${item.documentoId}::${item.custoConfigId}`, { componente: item.componente })
      }
    }
  } else {
    pendencias.push({ motivo: 'processo sem Tipo de Processo do motor — nenhuma regra documental se aplica' })
  }

  // ── 3. LINHAS — os registros que o cadastro declara como da planilha ──────
  // Precisam vir ANTES do preço: a coluna sozinha não sabe qual item precifica,
  // quem diz isso é a linha.
  const tiposDaPlanilha = await prisma.tipoDocumentoCadastro.findMany({
    where: { participaPlanilha: true },
    orderBy: { id: 'asc' },
    select: { id: true, name: true, legacyEnumKey: true, code: true, itemCatalogoId: true },
  })
  const idsTipo = tiposDaPlanilha.map((t) => t.id)
  const enumsTipo = tiposDaPlanilha.map((t) => t.legacyEnumKey).filter((v): v is string => !!v)
  const tipoPorEnum = new Map(tiposDaPlanilha.filter((t) => t.legacyEnumKey).map((t) => [t.legacyEnumKey as string, t]))

  // ── 4. A MATRIZ — qual item canônico cada interseção resolve ──────────────
  // Índice de Configurações Financeiras POR ITEM do catálogo, com a categoria do
  // item lida do mestre. Uma consulta para a matriz inteira: a resolução depois
  // é em memória, e é isso que impede o N+1 por célula.
  const candidatos = await prisma.produtoFinanceiro.findMany({
    where: { ativo: true, itemCatalogoId: { not: null } },
    select: { id: true, itemCatalogoId: true, itemCatalogo: { select: { id: true, name: true, categoriaId: true } } },
  })
  const porItem = new Map<number, ConfigCandidata[]>()
  const nomeDoItem = new Map<number, string>()
  for (const c of candidatos) {
    if (c.itemCatalogoId == null) continue
    nomeDoItem.set(c.itemCatalogoId, c.itemCatalogo?.name ?? '')
    porItem.set(c.itemCatalogoId, [
      ...(porItem.get(c.itemCatalogoId) ?? []),
      { configId: c.id, itemCatalogoId: c.itemCatalogoId, categoriaItemId: c.itemCatalogo?.categoriaId ?? null },
    ])
  }
  // Coluna de serviço fixo também precisa saber que item ela resolve, para a
  // explicação da célula poder nomeá-lo.
  const itemDaConfig = new Map<number, number | null>(candidatos.map((c) => [c.id, c.itemCatalogoId]))

  const colunasMatriz: ColunaMatriz[] = configuradas.map((c) => ({
    id: c.id,
    estrategia: c.estrategia,
    configId: c.configId,
    categoriaItemId: c.categoriaItemId,
  }))

  /** (coluna × registro) → item canônico. Resolvido UMA vez, não por pessoa. */
  const intersecao = new Map<string, ResolucaoMatriz>()
  for (const col of colunasMatriz) {
    for (const t of tiposDaPlanilha) {
      intersecao.set(
        `${col.id}::${t.id}`,
        resolverIntersecao(col, { tipoDocumentoId: t.id, itemCatalogoId: t.itemCatalogoId }, porItem),
      )
    }
  }

  // Ambiguidade é erro de cadastro e vira pendência VISÍVEL — nunca um número.
  for (const [chave, r] of intersecao) {
    if (r.tipo !== 'AMBIGUO') continue
    const [colId, tipoId] = chave.split('::')
    pendencias.push({
      motivo: 'mais de uma Configuração Financeira para a mesma célula',
      detalhe: `coluna ${colId} × registro ${tipoId}: candidatas ${r.candidatos.join(', ')} — a célula fica sem valor até o cadastro decidir`,
    })
  }

  // ── 5. PREÇO — uma resolução por CONFIG RESOLVIDA, não por célula ─────────
  // Com 6 pessoas × 3 registros × 5 colunas (90 células) e 7 configs distintas,
  // são 7 resoluções de preço. O custo cresce com o CADASTRO, não com a família.
  const configsUsadas = new Set<number>()
  for (const r of intersecao.values()) if (r.tipo === 'RESOLVIDO') configsUsadas.add(r.configId)

  const precoPorConfig = new Map<number, PrecoDaColuna>()
  for (const configId of configsUsadas) {
    const r = await resolverPrecoPorConfigDB(configId, {
      processoId,
      tipoProcessoId: processo?.tipoProcessoMotorId != null ? String(processo.tipoProcessoMotorId) : '',
      natureza: NaturezaPreco.CUSTO, // PLANILHA DE CUSTOS: nunca preço de venda.
    })
    precoPorConfig.set(configId, r.ok && !r.conflito
      ? { ok: true, valor: r.valor, moeda: String(r.moeda), tabelaValorId: r.tabelaValorId, razao: r.razao, motivo: null }
      : { ok: false, valor: 0, moeda: null, tabelaValorId: null, razao: '', motivo: r.ok ? (r.conflito?.nota ?? 'conflito de preço') : r.razao })
  }

  // ── 5b. COMBINADOS DESTE PROCESSO — uma consulta, não uma por célula ──────
  const overrides = await overridesDoProcesso(processoId)

  // ── 4. REALIZADO — obrigações já lançadas (valor congelado) ───────────────
  const obrigacoes = await listarObrigacoes({ processoId, natureza: 'CUSTO' })
  const comVinculo = obrigacoes.filter((o) => o.documentoId != null && o.configFinanceiraId != null)
  const custosSemVinculo = obrigacoes.length - comVinculo.length
  const realizadoPorCelula = new Map<string, ObrigacaoLista[]>()
  for (const o of comVinculo) {
    const k = `${o.documentoId}::${o.configFinanceiraId}`
    realizadoPorCelula.set(k, [...(realizadoPorCelula.get(k) ?? []), o])
  }

  // PESSOAS ATIVAS da árvore — recorte canônico. Quem saiu não deixa bloco órfão,
  // e quem é requerente do processo mas nunca entrou na árvore não aparece aqui.
  const pessoas = processo?.arvoreId
    ? await prisma.pessoa.findMany({
        where: pessoasAtivasDaArvore(processo.arvoreId),
        orderBy: [{ numeroLinhagem: 'asc' }, { ordemCusto: 'asc' }, { id: 'asc' }],
        select: {
          id: true, nome: true, sobrenome: true, numeroLinhagem: true, sexo: true, requerente: true, linhaReta: true,
          paiId: true, maeId: true,
          pai: { select: { nome: true, sobrenome: true } },
          mae: { select: { nome: true, sobrenome: true } },
          unioesComoPessoa1: { select: { pessoa2: { select: { nome: true, sobrenome: true } } } },
          unioesComoPessoa2: { select: { pessoa1: { select: { nome: true, sobrenome: true } } } },
          documentos: {
            where: {
              status: { notIn: ['CANCELADO', 'INVALIDO'] },
              ...(idsTipo.length || enumsTipo.length
                ? { OR: [
                    ...(idsTipo.length ? [{ documentTypeId: { in: idsTipo } }] : []),
                    ...(enumsTipo.length ? [{ tipo: { in: enumsTipo as never } }] : []),
                  ] }
                : { id: -1 }),
            },
            orderBy: { id: 'asc' },
            select: {
              id: true, tipo: true, documentTypeId: true, observacoes: true,
              cartorio: true, livro: true, folha: true, termo: true, numero_registro: true,
              data_registro: true, cidade_registro: true, estado_registro: true, conjuge_registrado: true,
            },
          },
        },
      })
    : []

  // ── 5b. GERAÇÃO E CLASSIFICAÇÃO — do motor canônico, nunca recalculadas ────
  // `montarPessoasDoProcesso` é o MESMO resolvedor que a Central Operacional usa
  // para dizer geração e linha principal. A planilha consome; não opina.
  const unioes = processo?.arvoreId
    ? await prisma.uniao.findMany({
        where: { OR: [{ pessoa1: { arvoreId: processo.arvoreId } }, { pessoa2: { arvoreId: processo.arvoreId } }] },
        select: { id: true, pessoa1Id: true, pessoa2Id: true },
      })
    : []
  const roster = montarPessoasDoProcesso(
    pessoas.map((p) => ({
      id: p.id, nome: p.nome, sobrenome: p.sobrenome, sexo: p.sexo, publicCode: null,
      numeroLinhagem: p.numeroLinhagem, requerente: p.requerente, linhaReta: p.linhaReta,
      paiId: p.paiId, maeId: p.maeId,
    })) as never,
    unioes,
  )
  // GERAÇÃO EXIBIDA CONTA DE CIMA PARA BAIXO, como na referência: 1 é o
  // ascendente mais antigo da árvore e o requerente é o número mais alto.
  //
  // O motor conta ao contrário — `geracao` é a distância ATÉ o requerente (0 =
  // requerente, 1 = pai, 2 = avô) — porque é isso que o parentesco precisa
  // saber. Inverter é apresentação, não recálculo: não se toca no motor, só se
  // lê a mesma medida a partir do outro extremo.
  const maiorGeracao = roster.reduce((m, r) => (r.geracao == null ? m : Math.max(m, r.geracao)), 0)
  const geracaoPorPessoa = new Map(
    roster.map((r) => [r.pessoaId, r.geracao == null ? null : maiorGeracao - r.geracao + 1]),
  )
  const principalPorPessoa = new Map(roster.map((r) => [r.pessoaId, r.classificacao === "LINHA_PRINCIPAL"]))
  // O papel na linhagem ("bisavô", "pai", "Requerente") é do motor de parentesco.
  // Deduzi-lo do número da geração seria inventar: geração 1 é o topo EXIBIDO,
  // não uma posição familiar, e o rótulo mudaria de significado a cada árvore.
  const posicaoPorPessoa = new Map(roster.map((r) => [r.pessoaId, r.posicao]))

  // ── 6. GRADE ──────────────────────────────────────────────────────────────
  const totaisPorServicoCent: Record<number, number> = {}
  for (const c of colunas) totaisPorServicoCent[c.tipoServicoId] = 0
  let totalGeralCent = 0, previstoCent = 0, realizadoCent = 0, naoConvertidoGeral = 0
  // Quanto do total é projeção sem regra publicada. Não é um total paralelo:
  // é uma FATIA de `totalGeralCent`, para o domínio saber o que ainda depende
  // de cadastro.
  let baseCent = 0

  const blocos: BlocoPessoa[] = pessoas.map((p) => {
    // A LINHA É O TIPO DECLARADO, não o documento. Ela existe mesmo sem
    // documento — antes a linha nascia do documento, então o registro que
    // faltava simplesmente não aparecia, e é exatamente a falta que esta
    // planilha existe para mostrar.
    //
    // O casamento por `documentTypeId` é por ID; `tipo` (enum legado) só é
    // consultado quando o documento ainda não migrou para a FK.
    const docPorTipo = new Map<number, (typeof p.documentos)[number]>()
    for (const d of p.documentos) {
      const tipoId = d.documentTypeId ?? (d.tipo ? tipoPorEnum.get(String(d.tipo))?.id ?? null : null)
      if (tipoId != null && !docPorTipo.has(tipoId)) docPorTipo.set(tipoId, d)
    }
    const linhas: LinhaPlanilha[] = tiposDaPlanilha.map((tipoLinha) => {
      const d = docPorTipo.get(tipoLinha.id) ?? null
      let totalLinhaCent = 0
      let naoConvLinha = 0

      const celulas: CelulaPlanilha[] = configuradas.map((cfg, i) => {
        const col = colunas[i]

        // A INTERSEÇÃO: qual item canônico esta ETAPA produz sobre ESTE
        // registro. Já resolvida uma vez para toda a planilha.
        const res = intersecao.get(`${cfg.id}::${tipoLinha.id}`) ?? { tipo: 'SEM_ITEM' as const, motivo: 'interseção não resolvida' }
        const configResolvida = res.tipo === 'RESOLVIDO' ? res.configId : null
        const itemId = configResolvida != null ? itemDaConfig.get(configResolvida) ?? null : null

        const chave = `${d?.id ?? 0}::${configResolvida}`
        const obrs = configResolvida != null ? realizadoPorCelula.get(chave) ?? [] : []
        const aplica = configResolvida != null && aplicavel.has(chave)
        const preco = configResolvida != null ? precoPorConfig.get(configResolvida) : undefined

        const over = overrides.get(chaveDaCelula({
          processoId, pessoaId: p.id, tipoDocumentoId: tipoLinha.id, colunaId: cfg.id,
        }))

        const explicaBase = {
          servico: cfg.rotulo,
          registro: tipoLinha.name,
          itemResolvidoId: itemId,
          itemResolvidoNome: itemId != null ? nomeDoItem.get(itemId) ?? null : null,
        }
        const base = {
          colunaId: cfg.id, tipoServicoId: col.tipoServicoId, naoConvertido: 0, obrigacoes: [] as number[],
          valorBase: null as number | null, valorOverride: over ? over.valor : null,
          valorEfetivo: null as number | null, editavel: false,
        }

        // AMBIGUIDADE VEM ANTES DE TUDO: com duas configurações candidatas não
        // existe "o" preço desta célula, e qualquer número aqui seria escolha
        // arbitrária disfarçada de resultado.
        if (res.tipo === 'AMBIGUO') {
          return {
            ...base, estado: 'AMBIGUO' as const, valor: null, valorBrl: null, moeda: null, automatico: false,
            explicacao: {
              ...explicaBase, origem: null, tabelaValorId: null, regra: null, moeda: null, obrigacoes: [],
              motivo: `${res.motivo} Candidatas: ${res.candidatos.join(', ')}.`, valorBase: null,
            },
          }
        }

        // REALIZADO tem precedência sobre previsão e sobre combinado: o fato
        // manda. Esconder um custo lançado seria mentir.
        if (obrs.length > 0) {
          const valorBrlCent = obrs.reduce((s, o) => s + paraCentavos(o.contratadoBrl), 0)
          const naoConv = obrs.reduce((s, o) => s + num(o.naoConvertido), 0)
          const moedas = [...new Set(obrs.map((o) => o.moeda))]
          totaisPorServicoCent[col.tipoServicoId] += valorBrlCent
          totalLinhaCent += valorBrlCent
          realizadoCent += valorBrlCent
          naoConvLinha += naoConv
          return {
            ...base,
            estado: 'REALIZADO' as const,
            valor: paraReais(obrs.reduce((s, o) => s + paraCentavos(o.valorContratado), 0)),
            valorBrl: paraReais(valorBrlCent),
            valorEfetivo: paraReais(valorBrlCent),
            moeda: moedas.length === 1 ? moedas[0] : null,
            naoConvertido: naoConv,
            automatico: obrs.every((o) => ehAutomatico(o.origemLancamento)),
            obrigacoes: obrs.map((o) => o.obrigacaoId),
            explicacao: {
              ...explicaBase,
              origem: 'Lançamento realizado (valor congelado)' as const,
              tabelaValorId: null, regra: null,
              moeda: moedas.length === 1 ? moedas[0] : null,
              obrigacoes: obrs.map((o) => o.obrigacaoId),
              motivo: null, valorBase: null,
            },
          }
        }

        const precoBase = preco?.ok ? preco.valor : null

        if (!aplica) {
          // SEM ITEM não tem o que mostrar: a etapa não produz nada aqui.
          if (res.tipo === 'SEM_ITEM' || precoBase == null) {
            return {
              ...base, estado: 'NAO_APLICAVEL' as const, valor: null, valorBrl: null, moeda: null, automatico: false,
              explicacao: {
                ...explicaBase, origem: null, tabelaValorId: null, regra: null, moeda: null, obrigacoes: [],
                motivo: res.tipo === 'SEM_ITEM'
                  ? res.motivo
                  : 'A Regra Documental ainda não diz se esta etapa se aplica a este registro, e não há preço de custo cadastrado.',
                valorBase: null,
              },
            }
          }

          // O ITEM EXISTE E TEM PREÇO — só a aplicabilidade está em aberto.
          // Esconder o valor aqui era o defeito: a planilha dizia "—" com
          // R$ 146,24 cadastrado e resolvível. O número aparece, e o total
          // oficial não o assume (ele vai para `totalBaseBrl`).
          //
          // Um combinado manual continua valendo mesmo neste estado: definir o
          // valor é decisão operacional explícita do usuário, não automação.
          if (over) {
            // O COMBINADO CONTA NO TOTAL, mesmo sem regra publicada.
            //
            // O preço base não conta porque ninguém o assumiu — ele é só o que
            // a Tabela diz. Um combinado é o oposto: alguém digitou aquele
            // valor naquela célula. Deixá-lo fora do total faria a planilha
            // ignorar a única decisão explícita que existe ali.
            const centO = paraCentavos(over.valor)
            const emBrlO = over.moeda === 'BRL'
            if (emBrlO) {
              totaisPorServicoCent[col.tipoServicoId] += centO
              totalLinhaCent += centO
              previstoCent += centO
            } else {
              naoConvLinha += over.valor
            }
            return {
              ...base,
              estado: 'SOBRESCRITO' as const,
              valor: paraReais(centO),
              valorBrl: emBrlO ? paraReais(centO) : null,
              valorBase: precoBase,
              valorEfetivo: paraReais(centO),
              moeda: over.moeda,
              automatico: false,
              editavel: true,
              explicacao: {
                ...explicaBase,
                origem: 'Combinado deste processo' as const,
                tabelaValorId: preco?.tabelaValorId ?? null,
                regra: preco?.razao || null,
                moeda: over.moeda, obrigacoes: [],
                motivo: over.motivo ?? 'Aplicabilidade ainda não definida pela Regra Documental.',
                valorBase: precoBase,
              },
            }
          }

          // O VALOR VISÍVEL SOMA. A planilha é de previsão de custo: um número
          // impresso na célula que não entra no total quebra a aritmética que o
          // operador confere de cabeça — 15 células de R$ 146,24 têm de dar
          // R$ 2.193,60, e não R$ 0,00 com o valor exilado num rótulo à parte.
          //
          // Projetar não é lançar. A distinção entre projeção e custo assumido
          // continua existindo, mas no DOMÍNIO: `totalBaseBrl` diz quanto do
          // total ainda depende de Regra Documental, e nenhuma obrigação nasce
          // daqui. Ela não vive na conta que aparece na tela.
          const centB = paraCentavos(precoBase)
          const emBrlB = preco?.moeda === 'BRL'
          if (emBrlB) {
            totaisPorServicoCent[col.tipoServicoId] += centB
            totalLinhaCent += centB
            previstoCent += centB
            baseCent += centB
          } else {
            naoConvLinha += precoBase
          }
          return {
            ...base,
            estado: 'BASE_DISPONIVEL' as const,
            valor: paraReais(centB),
            valorBrl: emBrlB ? paraReais(centB) : null,
            valorBase: precoBase,
            valorEfetivo: emBrlB ? paraReais(centB) : null,
            moeda: preco?.moeda ?? null,
            automatico: false,
            editavel: true,
            explicacao: {
              ...explicaBase,
              origem: 'Tabela de Preços' as const,
              tabelaValorId: preco?.tabelaValorId ?? null,
              regra: preco?.razao || null,
              moeda: preco?.moeda ?? null,
              obrigacoes: [],
              motivo: 'Preço cadastrado. A Regra Documental ainda não definiu se esta etapa se aplica — por isso não entra no total.',
              valorBase: precoBase,
            },
          }
        }

        // A partir daqui a etapa APLICA — a célula aceita combinado, mesmo que a
        // Tabela ainda não tenha preço para ela.

        // O COMBINADO PASSA NA FRENTE DA TABELA — sem apagá-la. `valorBase`
        // continua ali para a explicação poder dizer o que deixou de valer.
        if (over) {
          const cent = paraCentavos(over.valor)
          const emBrl = over.moeda === 'BRL'
          if (emBrl) {
            totaisPorServicoCent[col.tipoServicoId] += cent
            totalLinhaCent += cent
            previstoCent += cent
          } else {
            naoConvLinha += over.valor
          }
          return {
            ...base,
            estado: 'SOBRESCRITO' as const,
            valor: paraReais(cent),
            valorBrl: emBrl ? paraReais(cent) : null,
            valorBase: precoBase,
            valorEfetivo: paraReais(cent),
            moeda: over.moeda,
            naoConvertido: emBrl ? 0 : over.valor,
            automatico: false,
            editavel: true,
            explicacao: {
              ...explicaBase,
              origem: 'Combinado deste processo' as const,
              tabelaValorId: preco?.tabelaValorId ?? null,
              regra: preco?.razao || null,
              moeda: over.moeda,
              obrigacoes: [],
              motivo: over.motivo,
              valorBase: precoBase,
            },
          }
        }

        if (!preco?.ok) {
          return {
            ...base, estado: 'SEM_PRECO' as const, valor: null, valorBrl: null, moeda: null, automatico: false,
            editavel: true,
            explicacao: {
              ...explicaBase, origem: 'Tabela de Preços' as const, tabelaValorId: null, regra: null,
              moeda: null, obrigacoes: [],
              motivo: preco?.motivo ?? 'Sem preço de custo vigente na Tabela de Preços.',
              valorBase: null,
            },
          }
        }

        // PREVISTO — projeção pela tabela VIGENTE. Muda quando a tabela muda.
        // A conversão para BRL de moeda estrangeira é do domínio de câmbio; aqui
        // o previsto só soma ao total quando já está em BRL, e o que não converte
        // é declarado em `naoConvertido` em vez de virar um número inventado.
        const emBrl = preco.moeda === 'BRL'
        const valorCent = paraCentavos(preco.valor)
        if (emBrl) {
          totaisPorServicoCent[col.tipoServicoId] += valorCent
          totalLinhaCent += valorCent
          previstoCent += valorCent
        } else {
          naoConvLinha += preco.valor
        }
        return {
          ...base,
          estado: 'PREVISTO' as const,
          valor: paraReais(valorCent),
          valorBrl: emBrl ? paraReais(valorCent) : null,
          valorBase: preco.valor,
          valorEfetivo: emBrl ? paraReais(valorCent) : null,
          moeda: preco.moeda,
          naoConvertido: emBrl ? 0 : preco.valor,
          automatico: true,
          editavel: true,
          explicacao: {
            ...explicaBase,
            origem: 'Tabela de Preços' as const,
            tabelaValorId: preco.tabelaValorId,
            regra: preco.razao || null,
            moeda: preco.moeda,
            obrigacoes: [],
            motivo: null,
            valorBase: preco.valor,
          },
        }
      })

      totalGeralCent += totalLinhaCent
      naoConvertidoGeral += naoConvLinha
      return {
        documentoId: d?.id ?? 0,
        // O cônjuge que a referência mostra é o que CONSTA NA CERTIDÃO, não o da
        // árvore. Só o registro de casamento costuma trazê-lo, e é por isso que
        // as outras linhas ficam vazias — sem nenhuma regra por tipo aqui: a
        // linha mostra o que o documento dela registrou.
        conjuge: d?.conjuge_registrado ?? null,
        paiNome: p.pai ? nomeCompleto(p.pai) : null,
        maeNome: p.mae ? nomeCompleto(p.mae) : null,
        pessoaId: p.id,
        tipoDocumentoId: tipoLinha.id,
        tipoDocumentoNome: tipoLinha.name,
        tipoRegistro: tipoLinha.name,
        dataRegistro: d?.data_registro ? new Date(d.data_registro).toISOString() : null,
        local: d ? ([d.cidade_registro, d.estado_registro].filter(Boolean).join(' - ') || null) : null,
        cartorio: d?.cartorio ?? null, livro: d?.livro ?? null, folha: d?.folha ?? null, termo: d?.termo ?? null,
        numeroRegistro: d?.numero_registro ?? null,
        observacao: d?.observacoes ?? null,
        localizado: d ? estaLocalizado(d) : false,
        celulas,
        totalBrl: paraReais(totalLinhaCent),
        naoConvertido: naoConvLinha,
      }
    })

    return {
      pessoaId: p.id,
      nome: nomeCompleto(p),
      numeroLinhagem: p.numeroLinhagem ?? null,
      // Geração e classificação vêm do MOTOR canônico da árvore, o mesmo que a
      // Central usa — a planilha não recalcula parentesco.
      geracao: geracaoPorPessoa.get(p.id) ?? null,
      linhagemPrincipal: principalPorPessoa.get(p.id) ?? false,
      posicao: posicaoPorPessoa.get(p.id) ?? null,
      conjuges: [
        ...p.unioesComoPessoa1.map((u) => (u.pessoa2 ? nomeCompleto(u.pessoa2) : '')),
        ...p.unioesComoPessoa2.map((u) => (u.pessoa1 ? nomeCompleto(u.pessoa1) : '')),
      ].filter(Boolean),
      paiNome: p.pai ? nomeCompleto(p.pai) : null,
      maeNome: p.mae ? nomeCompleto(p.mae) : null,
      linhas,
      totalBrl: paraReais(linhas.reduce((s, l) => s + paraCentavos(l.totalBrl), 0)),
      naoConvertido: linhas.reduce((s, l) => s + l.naoConvertido, 0),
    }
  })

  return {
    processoId,
    colunas,
    pessoas: blocos,
    totaisPorServico: Object.fromEntries(
      Object.entries(totaisPorServicoCent).map(([k, v]) => [k, paraReais(v)]),
    ),
    totalGeralBrl: paraReais(totalGeralCent),
    totalPrevistoBrl: paraReais(previstoCent),
    totalRealizadoBrl: paraReais(realizadoCent),
    totalBaseBrl: paraReais(baseCent),
    naoConvertido: naoConvertidoGeral,
    custosSemVinculo,
    pendencias,
  }
}
