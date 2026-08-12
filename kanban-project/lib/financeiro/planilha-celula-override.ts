// lib/financeiro/planilha-celula-override.ts
// ============================================================================
// O VALOR COMBINADO DE UMA CÉLULA — e por que ele não é um preço.
//
// A Tabela de Preços continua sendo a fonte canônica do valor padrão. O
// override não a corrige: ele diz "neste processo, nesta pessoa, neste
// registro, nesta etapa, o combinado foi outro". Um cartório que cobrou a mais,
// um desconto negociado, uma taxa extra — fatos de UM processo, que não podem
// virar preço de tabela para todos os outros.
//
// Por isso:
//   · escrever aqui NUNCA toca em TabelaValor;
//   · a célula continua carregando o preço base que deixou de valer;
//   · o valor efetivo é `override ?? base`, calculado na leitura.
//
// ─── A IDENTIDADE É A INTERSEÇÃO INTEIRA ────────────────────────────────────
// processo + pessoa + registro (tipo documental) + coluna. Por IDs. Trocar
// qualquer um dos quatro é outra célula, e o `@@unique` no banco impede que
// dois combinados disputem a mesma.
//
// Repare que a âncora é o TIPO DOCUMENTAL, não o documento concreto: o
// combinado vale para "a certidão de nascimento do Valdir", tenha ela sido
// localizada ou não. Amarrar ao `Documento.id` faria o valor sumir no dia em
// que o documento fosse substituído.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

export interface CelulaAlvo {
  processoId: number
  pessoaId: number
  tipoDocumentoId: number
  colunaId: number
}

export interface OverrideGravado {
  id: number
  valor: number
  moeda: string
  autorId: number | null
  motivo: string | null
  atualizadoEm: Date
}

const inteiroPositivo = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0

function exigirAlvo(alvo: CelulaAlvo) {
  for (const [campo, valor] of Object.entries(alvo)) {
    if (!inteiroPositivo(valor)) {
      throw new Error(`Override da planilha exige ${campo} válido; recebido: ${String(valor)}`)
    }
  }
}

/**
 * Grava (ou substitui) o combinado desta célula.
 *
 * Zero é um valor LEGÍTIMO — "esta etapa saiu de graça neste processo" é uma
 * informação, e é diferente de "não sei o preço". Só o negativo é recusado:
 * desconto se registra abatendo o valor, não invertendo o sinal de um custo.
 */
export async function definirOverride(
  alvo: CelulaAlvo,
  args: { valor: number; moeda?: string; autorId?: number | null; motivo?: string | null },
): Promise<OverrideGravado> {
  exigirAlvo(alvo)
  if (!Number.isFinite(args.valor) || args.valor < 0) {
    throw new Error(`Valor de override inválido: ${String(args.valor)}`)
  }
  const moeda = (args.moeda ?? 'BRL').toUpperCase()
  const valor = new Prisma.Decimal(args.valor.toFixed(2))

  const anterior = await prisma.planilhaCelulaOverride.findUnique({
    where: { processoId_pessoaId_tipoDocumentoId_colunaId: alvo },
    select: { valor: true, moeda: true },
  })

  const gravado = await prisma.planilhaCelulaOverride.upsert({
    where: { processoId_pessoaId_tipoDocumentoId_colunaId: alvo },
    create: { ...alvo, valor, moeda, autorId: args.autorId ?? null, motivo: args.motivo ?? null },
    update: { valor, moeda, autorId: args.autorId ?? null, motivo: args.motivo ?? null },
    select: { id: true, valor: true, moeda: true, autorId: true, motivo: true, atualizadoEm: true },
  })

  await registrar(alvo, {
    acao: anterior ? 'PLANILHA_OVERRIDE_ALTERADO' : 'PLANILHA_OVERRIDE_DEFINIDO',
    id: gravado.id,
    de: anterior ? { valor: Number(anterior.valor), moeda: anterior.moeda } : null,
    para: { valor: Number(gravado.valor), moeda: gravado.moeda },
    autorId: args.autorId ?? null,
    motivo: args.motivo ?? null,
  })

  return { ...gravado, valor: Number(gravado.valor) }
}

/**
 * Remove o combinado — a célula volta a valer o preço da Tabela.
 *
 * Devolve `false` quando não havia override: remover duas vezes não é erro, e
 * transformar isso em exceção faria a tela quebrar num duplo-clique.
 */
export async function removerOverride(
  alvo: CelulaAlvo,
  args: { autorId?: number | null } = {},
): Promise<boolean> {
  exigirAlvo(alvo)
  const atual = await prisma.planilhaCelulaOverride.findUnique({
    where: { processoId_pessoaId_tipoDocumentoId_colunaId: alvo },
    select: { id: true, valor: true, moeda: true },
  })
  if (!atual) return false

  await prisma.planilhaCelulaOverride.delete({ where: { id: atual.id } })
  await registrar(alvo, {
    acao: 'PLANILHA_OVERRIDE_REMOVIDO',
    id: atual.id,
    de: { valor: Number(atual.valor), moeda: atual.moeda },
    para: null,
    autorId: args.autorId ?? null,
    motivo: null,
  })
  return true
}

/** Todos os combinados de um processo, indexados pela célula. Uma consulta. */
export async function overridesDoProcesso(processoId: number): Promise<Map<string, OverrideGravado>> {
  const linhas = await prisma.planilhaCelulaOverride.findMany({
    where: { processoId },
    select: {
      id: true, pessoaId: true, tipoDocumentoId: true, colunaId: true,
      valor: true, moeda: true, autorId: true, motivo: true, atualizadoEm: true,
    },
  })
  return new Map(
    linhas.map((l) => [
      `${processoId}::${l.pessoaId}::${l.tipoDocumentoId}::${l.colunaId}`,
      {
        id: l.id, valor: Number(l.valor), moeda: l.moeda,
        autorId: l.autorId, motivo: l.motivo, atualizadoEm: l.atualizadoEm,
      },
    ]),
  )
}

/**
 * A trilha. Dinheiro combinado à mão sem quem/quando/de-quanto-para-quanto é
 * exatamente o buraco que uma auditoria encontra seis meses depois.
 */
async function registrar(
  alvo: CelulaAlvo,
  ev: {
    acao: string
    id: number
    de: { valor: number; moeda: string } | null
    para: { valor: number; moeda: string } | null
    autorId: number | null
    motivo: string | null
  },
) {
  const descricao =
    ev.para == null
      ? `Override removido da célula (processo ${alvo.processoId}, pessoa ${alvo.pessoaId}, registro ${alvo.tipoDocumentoId}, coluna ${alvo.colunaId}). A célula volta ao preço da Tabela de Preços.`
      : `Valor da célula combinado em ${ev.para.moeda} ${ev.para.valor.toFixed(2)}` +
        (ev.de ? ` (era ${ev.de.moeda} ${ev.de.valor.toFixed(2)})` : '') +
        `. A Tabela de Preços NÃO foi alterada.`

  await prisma.logAuditoria.create({
    data: {
      acao: ev.acao,
      entidade: 'PlanilhaCelulaOverride',
      entidadeId: ev.id,
      usuarioId: ev.autorId ?? undefined,
      descricao,
      detalhes: { ...alvo, de: ev.de, para: ev.para, motivo: ev.motivo },
    },
  })
}
