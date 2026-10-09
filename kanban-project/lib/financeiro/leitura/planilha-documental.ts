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
import { calcularGeracoes } from '@/src/lib/genealogia/geracao'
import { compararCertidoesDaFamilia } from '@/lib/operacional/ordem-certidoes'
import { montarPessoasDoProcesso } from '@/src/lib/process-stage/central-operacional-core'
import {
  resolverIntersecao, chaveDaCelula,
  type ColunaMatriz, type ConfigCandidata, type ResolucaoMatriz,
} from './planilha-matriz'
import { overridesDoProcesso } from '../planilha-celula-override'
import { DOCUMENTO_STATUS_NOT_IN_INATIVOS } from "@/src/lib/documentos/status-inativos"

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
  /** O documento que a linha MOSTRA (0 quando a linha existe por contrato, documento ausente). No casamento pode ser o da união. */
  documentoId: number
  /** O documento DESTA pessoa (0 se não tem): é com ele que o financeiro casa lançamentos. */
  documentoProprioId: number
  /** Cônjuge relevante para ESTA linha (só o casamento costuma ter). */
  conjuge: string | null
  paiNome: string | null
  maeNome: string | null
  pessoaId: number | null
  tipoDocumentoId: number | null
  tipoDocumentoNome: string | null
  tipoRegistro: string | null
  dataEvento: string | null
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

// ── O QUE CADA COLUNA LÊ (07/10/2026, caso Ilaine Fogli) ──────────────────────────────────────────────────────────────────────────
//   Data do evento    Documento.data_evento → a árvore: nascimento = Pessoa.data_nasc, óbito = Pessoa.data_obito, casamento = União.data_inicio.
//   Data do registro  Documento.data_registro → (casamento) União.data_registro. NUNCA o evento no lugar do registro, nem o contrário. Datas de calendário: UTC.
//   Local      Documento (cidade - estado) → a árvore: nascimento = Pessoa.local_nasc/estado_nasc, óbito = Pessoa.local_obito/estado_obito, casamento = União.local/estado.
//   Dados do registro  Documento.cartório/livro/folha/termo → (casamento) União.cartório/livro/folha/termo. «0» e vazio = sem dado.
//   Cônjuge    Documento.conjuge_registrado → (casamento) o outro cônjuge da União. Só a linha de casamento traz cônjuge.
//   Genitores  Pessoa.pai / Pessoa.mae.
//   A CERTIDÃO DE CASAMENTO é da UNIÃO: o Documento fica numa das duas pessoas (a `pessoa1` da União). A linha de casamento dos DOIS cônjuges mostra
//   o mesmo registro — antes só quem era o dono do Documento via o casamento, e a outra pessoa aparecia com a linha vazia.
const CAMPOS_DA_UNIAO = { data_inicio: true, data_registro: true, local: true, estado: true, pais: true, cartorio: true, livro: true, folha: true, termo: true } as const
const CAMPOS_DO_DOCUMENTO = {
  id: true, tipo: true, documentTypeId: true, observacoes: true, pessoaId: true,
  cartorio: true, livro: true, folha: true, termo: true, numero_registro: true,
  data_registro: true, data_evento: true, cidade_registro: true, estado_registro: true, conjuge_registrado: true,
} as const

export type CategoriaDoRegistro = 'NASCIMENTO' | 'CASAMENTO' | 'OBITO' | null
export const categoriaDoRegistro = (nome: string | null | undefined): CategoriaDoRegistro => {
  const t = (nome ?? '').toLowerCase()
  if (/nasc/.test(t)) return 'NASCIMENTO'
  if (/casam/.test(t)) return 'CASAMENTO'
  if (/[óo]bito/.test(t)) return 'OBITO'
  return null
}
/** «0», «00» e vazio não são dado de registro (valor padrão de cadastro): viram `null` e a tela mostra «—». */
export const dadoDoRegistro = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim()
  return t === '' || /^0+$/.test(t) ? null : t
}
const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null)
const lugar = (a: string | null | undefined, b: string | null | undefined): string | null => [a, b].map((x) => (x ?? '').trim()).filter(Boolean).join(' - ') || null

/**
 * A ESTRUTURA DOCUMENTAL — quem aparece e o que cada registro diz. SEM DINHEIRO: nenhum preço, custo, total ou célula.
 *
 * É a metade NÃO financeira da planilha, e a ÚNICA fonte dela: `montarPlanilhaDocumental` (Financeiro → Custos) acrescenta os valores por
 * cima desta mesma estrutura, e a aba Documentos do processo a usa SOZINHA. Por isso as duas mostram as mesmas pessoas, na mesma ordem
 * (geração), com os mesmos registros — e a versão de Documentos nem consulta preço, lançamento ou regra econômica (nada financeiro chega a ser
 * lido, quanto mais enviado ao navegador).
 */
export interface LinhaEstrutural {
  /** O documento que a linha MOSTRA (0 quando a linha existe por contrato, documento ausente). No casamento pode ser o da UNIÃO (do outro cônjuge). */
  documentoId: number
  /** O documento que é DESTA pessoa (0 se não tem) — é com ele que o financeiro casa lançamentos: um custo nunca é contado nas duas linhas do casamento. */
  documentoProprioId: number
  conjuge: string | null
  paiNome: string | null
  maeNome: string | null
  pessoaId: number | null
  tipoDocumentoId: number | null
  tipoDocumentoNome: string | null
  tipoRegistro: string | null
  dataEvento: string | null
  dataRegistro: string | null
  local: string | null
  cartorio: string | null
  livro: string | null
  folha: string | null
  termo: string | null
  numeroRegistro: string | null
  observacao: string | null
  localizado: boolean
}
export interface BlocoEstrutural {
  pessoaId: number | null
  nome: string
  numeroLinhagem: number | null
  geracao: number | null
  linhagemPrincipal: boolean
  posicao: string | null
  conjuges: string[]
  paiNome: string | null
  maeNome: string | null
  linhas: LinhaEstrutural[]
}

export async function montarEstruturaDocumental(processoId: number): Promise<BlocoEstrutural[]> {
  const processo = await prisma.processo.findUnique({ where: { id: processoId }, select: { id: true, arvoreId: true } })
  const tiposDaPlanilha = await prisma.tipoDocumentoCadastro.findMany({
    where: { participaPlanilha: true },
    orderBy: { id: 'asc' },
    select: { id: true, name: true, legacyEnumKey: true, code: true, itemCatalogoId: true },
  })
  const idsTipo = tiposDaPlanilha.map((t) => t.id)
  const enumsTipo = tiposDaPlanilha.map((t) => t.legacyEnumKey).filter((v): v is string => !!v)
  const tipoPorEnum = new Map(tiposDaPlanilha.filter((t) => t.legacyEnumKey).map((t) => [t.legacyEnumKey as string, t]))
  const whereDosDocumentos = {
    status: { notIn: [...DOCUMENTO_STATUS_NOT_IN_INATIVOS, 'INVALIDO'] as never },
    ...(idsTipo.length || enumsTipo.length
      ? { OR: [
          ...(idsTipo.length ? [{ documentTypeId: { in: idsTipo } }] : []),
          ...(enumsTipo.length ? [{ tipo: { in: enumsTipo as never } }] : []),
        ] }
      : { id: -1 }),
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
          // O QUE A ÁRVORE JÁ SABE desta pessoa — fallback da linha quando o documento não traz o dado (nunca inventado: é o dado dela).
          data_nasc: true, data_obito: true, local_nasc: true, estado_nasc: true, pais_nasc: true, local_obito: true, estado_obito: true,
          pai: { select: { nome: true, sobrenome: true } },
          mae: { select: { nome: true, sobrenome: true } },
          unioesComoPessoa1: { select: { id: true, pessoa2Id: true, ...CAMPOS_DA_UNIAO, pessoa2: { select: { nome: true, sobrenome: true } } } },
          unioesComoPessoa2: { select: { id: true, pessoa1Id: true, ...CAMPOS_DA_UNIAO, pessoa1: { select: { nome: true, sobrenome: true } } } },
          documentos: { where: whereDosDocumentos, orderBy: { id: 'asc' }, select: CAMPOS_DO_DOCUMENTO },
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
  // GERAÇÃO EXIBIDA = A DE VERDADE (`calcularGeracoes`, o mesmo «G» de toda lista do sistema — ver `src/lib/genealogia/geracao.ts`): G1 é o ancestral
  // que origina o direito, o cônjuge tem a geração do parceiro, irmãos têm a mesma. Antes a planilha invertia a distância ao requerente do motor de
  // parentesco: com mais de um requerente em gerações diferentes ela dava «G2» a um filho do G3 e a ordem dos blocos saía fora da regra fixa (vigia e).
  const geracaoPorPessoa = calcularGeracoes(
    pessoas.map((p) => ({ id: p.id, paiId: p.paiId, maeId: p.maeId, linhaReta: p.linhaReta, requerente: p.requerente })),
    unioes,
  )
  const principalPorPessoa = new Map(roster.map((r) => [r.pessoaId, r.classificacao === "LINHA_PRINCIPAL"]))
  // O papel na linhagem ("bisavô", "pai", "Requerente") é do motor de parentesco.
  // Deduzi-lo do número da geração seria inventar: geração 1 é o topo EXIBIDO,
  // não uma posição familiar, e o rótulo mudaria de significado a cada árvore.
  const posicaoPorPessoa = new Map(roster.map((r) => [r.pessoaId, r.posicao]))

  // Os documentos dos CÔNJUGES: a certidão de casamento fica numa das duas pessoas da união e a outra a enxerga por aqui.
  const idsDosConjuges = [...new Set(pessoas.flatMap((p) => [...p.unioesComoPessoa1.map((u) => u.pessoa2Id), ...p.unioesComoPessoa2.map((u) => u.pessoa1Id)]))]
  const docsDosConjuges = idsDosConjuges.length
    ? await prisma.documento.findMany({ where: { pessoaId: { in: idsDosConjuges }, ...whereDosDocumentos }, orderBy: { id: 'asc' }, select: CAMPOS_DO_DOCUMENTO })
    : []
  const tipoIdDoDoc = (d: { documentTypeId: number | null; tipo: unknown }) => d.documentTypeId ?? (d.tipo ? tipoPorEnum.get(String(d.tipo))?.id ?? null : null)

  const blocos = pessoas.map((p) => {
    const docPorTipo = new Map<number, (typeof p.documentos)[number]>()
    for (const d of p.documentos) {
      const tipoId = d.documentTypeId ?? (d.tipo ? tipoPorEnum.get(String(d.tipo))?.id ?? null : null)
      if (tipoId != null && !docPorTipo.has(tipoId)) docPorTipo.set(tipoId, d)
    }
    // As uniões da pessoa, com o OUTRO cônjuge de cada uma.
    const uniaoDaPessoa = [
      ...p.unioesComoPessoa1.map((u) => ({ ...u, outroId: u.pessoa2Id, outro: u.pessoa2 })),
      ...p.unioesComoPessoa2.map((u) => ({ ...u, outroId: u.pessoa1Id, outro: u.pessoa1 })),
    ]
    const linhas: LinhaEstrutural[] = tiposDaPlanilha.map((tipoLinha) => {
      const categoria = categoriaDoRegistro(tipoLinha.name)
      type DocEstrutural = (typeof p.documentos)[number]
      let d = (docPorTipo.get(tipoLinha.id) ?? null) as DocEstrutural | null
      // CASAMENTO: sem documento próprio, vale o da UNIÃO (o que está no outro cônjuge); a união escolhida é a do documento, ou a primeira.
      let uniao = categoria === 'CASAMENTO' ? uniaoDaPessoa[0] ?? null : null
      if (categoria === 'CASAMENTO') {
        if (d) { const dono = d.pessoaId; uniao = uniaoDaPessoa.find((u) => u.outroId === dono) ?? uniao }
        else {
          for (const u of uniaoDaPessoa) {
            const doc = docsDosConjuges.find((x) => x.pessoaId === u.outroId && tipoIdDoDoc(x) === tipoLinha.id)
            if (doc) { d = doc as DocEstrutural; uniao = u; break }
          }
        }
      }
      return {
        documentoId: d?.id ?? 0,
        documentoProprioId: d && d.pessoaId === p.id ? d.id : (docPorTipo.get(tipoLinha.id)?.id ?? 0),
        // O cônjuge que a referência mostra é o que CONSTA NA CERTIDÃO, não o da
        // árvore. Só o registro de casamento costuma trazê-lo, e é por isso que
        // as outras linhas ficam vazias — sem nenhuma regra por tipo aqui: a
        // linha mostra o que o documento dela registrou.
        conjuge: d?.conjuge_registrado ?? (uniao?.outro ? nomeCompleto(uniao.outro) : null),
        paiNome: p.pai ? nomeCompleto(p.pai) : null,
        maeNome: p.mae ? nomeCompleto(p.mae) : null,
        pessoaId: p.id,
        tipoDocumentoId: tipoLinha.id,
        tipoDocumentoNome: tipoLinha.name,
        tipoRegistro: tipoLinha.name,
        // DATA DO EVENTO e DATA DO REGISTRO são duas colunas e nunca uma no lugar da outra. Evento: a do cadastro; sem ela, a que a ÁRVORE já tem
        // (nascimento = Pessoa.data_nasc, óbito = Pessoa.data_obito, casamento = União.data_inicio). Registro: só a do cadastro; casamento sem documento usa
        // União.data_registro. Pessoa não tem data de registro: fica «—». Nada é inventado.
        dataEvento: iso(d?.data_evento ?? (categoria === 'NASCIMENTO' ? p.data_nasc : categoria === 'OBITO' ? p.data_obito : categoria === 'CASAMENTO' ? uniao?.data_inicio : null)),
        dataRegistro: iso(d?.data_registro ?? (categoria === 'CASAMENTO' ? uniao?.data_registro : null)),
        // LOCAL: o do registro; sem ele, o da pessoa (nascimento) ou o da união (casamento). Óbito: o da árvore (Pessoa.local_obito/estado_obito).
        local: lugar(d?.cidade_registro, d?.estado_registro) ?? (categoria === 'NASCIMENTO' ? lugar(p.local_nasc, p.estado_nasc) : categoria === 'OBITO' ? lugar(p.local_obito, p.estado_obito) : categoria === 'CASAMENTO' ? lugar(uniao?.local, uniao?.estado) : null),
        // DADOS DO REGISTRO: «0» e vazio não são dado. O casamento sem documento usa o que está na União.
        cartorio: dadoDoRegistro(d?.cartorio) ?? (categoria === 'CASAMENTO' ? dadoDoRegistro(uniao?.cartorio) : null),
        livro: dadoDoRegistro(d?.livro) ?? (categoria === 'CASAMENTO' ? dadoDoRegistro(uniao?.livro) : null),
        folha: dadoDoRegistro(d?.folha) ?? (categoria === 'CASAMENTO' ? dadoDoRegistro(uniao?.folha) : null),
        termo: dadoDoRegistro(d?.termo) ?? (categoria === 'CASAMENTO' ? dadoDoRegistro(uniao?.termo) : null),
        numeroRegistro: d?.numero_registro ?? null,
        observacao: d?.observacoes ?? null,
        localizado: d ? estaLocalizado(d) : false,
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
    }
  })

  // A ORDEM FIXA, a mesma de toda lista (`compararCertidoesDaFamilia`): geração → linha reta antes de fora da linha → nascimento da pessoa.
  // `numeroLinhagem` continua ordenando só a pasta documental; aqui ele só desempata pela ordem em que a consulta já traz.
  const nascimentoDe = new Map(pessoas.map((p) => [p.id, p.data_nasc]))
  const linhaRetaDe = new Map(pessoas.map((p) => [p.id, p.linhaReta]))
  const chave = (b: { pessoaId: number; geracao: number | null }) => ({ geracao: b.geracao, linhaReta: linhaRetaDe.get(b.pessoaId) === true, pessoaNascimento: nascimentoDe.get(b.pessoaId) ?? null, pessoaId: b.pessoaId })
  return blocos.sort((a, b) => compararCertidoesDaFamilia(chave(a), chave(b)))

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

  // ── 6. GRADE ──────────────────────────────────────────────────────────────
  const totaisPorServicoCent: Record<number, number> = {}
  for (const c of colunas) totaisPorServicoCent[c.tipoServicoId] = 0
  let totalGeralCent = 0, previstoCent = 0, realizadoCent = 0, naoConvertidoGeral = 0
  // Quanto do total é projeção sem regra publicada. Não é um total paralelo:
  // é uma FATIA de `totalGeralCent`, para o domínio saber o que ainda depende
  // de cadastro.
  let baseCent = 0

  // A ESTRUTURA (pessoas, registros, geração) vem de `montarEstruturaDocumental` — a MESMA que a aba Documentos usa sem valores.
  const estrutura = await montarEstruturaDocumental(processoId)
  const blocos: BlocoPessoa[] = estrutura.map((b) => {
    const linhas: LinhaPlanilha[] = b.linhas.map((le) => {
      let totalLinhaCent = 0
      let naoConvLinha = 0

      const celulas: CelulaPlanilha[] = configuradas.map((cfg, i) => {
        const col = colunas[i]

        // A INTERSEÇÃO: qual item canônico esta ETAPA produz sobre ESTE
        // registro. Já resolvida uma vez para toda a planilha.
        const res = intersecao.get(`${cfg.id}::${le.tipoDocumentoId as number}`) ?? { tipo: 'SEM_ITEM' as const, motivo: 'interseção não resolvida' }
        const configResolvida = res.tipo === 'RESOLVIDO' ? res.configId : null
        const itemId = configResolvida != null ? itemDaConfig.get(configResolvida) ?? null : null

        const chave = `${le.documentoProprioId}::${configResolvida}`
        const obrs = configResolvida != null ? realizadoPorCelula.get(chave) ?? [] : []
        const aplica = configResolvida != null && aplicavel.has(chave)
        const preco = configResolvida != null ? precoPorConfig.get(configResolvida) : undefined

        const over = overrides.get(chaveDaCelula({
          processoId, pessoaId: b.pessoaId as number, tipoDocumentoId: le.tipoDocumentoId as number, colunaId: cfg.id,
        }))

        const explicaBase = {
          servico: cfg.rotulo,
          registro: (le.tipoDocumentoNome as string),
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
      return { ...le, celulas, totalBrl: paraReais(totalLinhaCent), naoConvertido: naoConvLinha }
    })

    return {
      ...b,
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
