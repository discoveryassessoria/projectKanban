// src/lib/process-stage/escopo-operacional-da-fase.ts
// ============================================================================
// SOBRE O QUE A FASE OPERA — a resposta que a materialização precisa.
//
// A materialização multiplica os passos publicados pelas entidades do escopo: uma
// fase DOCUMENTO gera um roteiro por certidão; uma fase PROCESSO gera um só. Esse
// dado vivia exclusivamente no catálogo em código (`fases-catalog.ts`), e era o que
// impedia uma fase criada pelo cadastro de existir de verdade: ela aparecia no
// seletor do Workflow Macro, entrava no fluxo, e então materializava como PROCESSO
// porque ninguém tinha como dizer o contrário.
//
// ─── A PRECEDÊNCIA, E POR QUE ESTA E NÃO A INVERSA ──────────────────────────
//   1. CATÁLOGO EM CÓDIGO, para as fases canônicas. Elas declaram mais do que
//      escopo — passos, pesos, SLA, ordem do fluxo — e o código continua sendo a
//      fonte disso. Deixar o cadastro sobrepor aqui permitiria mudar por tela o
//      escopo de uma fase que já tem processos em execução, e a fase mudaria de
//      forma debaixo deles.
//   2. CADASTRO (`CatalogoFase.escopo`), para as fases que só existem nele. É o
//      caminho das fases novas — e a razão de esta função existir.
//   3. NADA. Fase sem escopo em nenhum dos dois não é utilizável, e quem chama
//      recebe `null` para poder dizer isso ao operador em vez de adivinhar.
//
// Não há terceira fonte, e o cadastro não é adaptador de legado: ele é o cadastro.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import { FASES, phaseKeyToFaseCode } from "@/src/lib/process-stage/fases-catalog"
import { EQUIVALENCIA_LEGADA } from "@/src/lib/process-stage/verificar-phasekeys"

export type EscopoOperacional = "PROCESSO" | "PESSOA" | "NECESSIDADE" | "DOCUMENTO"

type DB = Prisma.TransactionClient | typeof prisma

/** O escopo declarado pelo CATÁLOGO EM CÓDIGO, quando a fase é uma das canônicas. */
export function escopoCanonicoDaFase(phaseKey: string): EscopoOperacional | null {
  const code = phaseKeyToFaseCode(phaseKey)
  return code ? (FASES[code].scope as EscopoOperacional) : null
}

/**
 * O escopo OPERACIONAL da fase, pela precedência acima.
 *
 * `db` é o cliente de quem chama: sob transação aberta, ler pelo cliente global
 * pediria uma segunda conexão enquanto a primeira está retida — o mesmo motivo pelo
 * qual `resolverWorkflowAplicavel` recebe o cliente.
 */
export async function resolverEscopoDaFase(
  phaseKey: string,
  db: DB = prisma,
): Promise<EscopoOperacional | null> {
  const doCodigo = escopoCanonicoDaFase(phaseKey)
  if (doCodigo) return doCodigo
  const cadastro = await db.catalogoFase.findUnique({
    where: { phaseKey },
    select: { escopo: true },
  })
  return (cadastro?.escopo as EscopoOperacional | null) ?? null
}

/**
 * A fase é UTILIZÁVEL num workflow? Devolve o motivo quando não é — o operador
 * precisa saber o que falta, não receber um seletor que aceita e um fluxo que trava.
 */
export interface AptidaoDaFase {
  apta: boolean
  escopo: EscopoOperacional | null
  motivo: string | null
  code: "OK" | "SEM_ESCOPO" | "CHAVE_LEGADA" | "INEXISTENTE"
  /** Quando a chave é legada: a canônica que deve ser usada no lugar. */
  canonica?: string
}

/**
 * AVALIA SE UMA FASE DO CADASTRO PODE ENTRAR NUM WORKFLOW.
 *
 * Três recusas possíveis, e nenhuma delas é "não está no código":
 *
 *   CHAVE_LEGADA — a chave é uma variante confirmada de uma canônica
 *                  (`EQUIVALENCIA_LEGADA`). Não é fase nova: é a mesma fase com o
 *                  nome antigo, e usá-la cria um fluxo que o motor não resolve. A
 *                  recusa NOMEIA a canônica — recusar sem dizer o que usar no lugar
 *                  é o que fez três macrofluxos nascerem quebrados.
 *   SEM_ESCOPO   — a fase existe no cadastro e não declarou sobre o que opera.
 *   INEXISTENTE  — não há fase com essa chave.
 *
 * Uma fase criada pelo cadastro, com escopo declarado e chave própria, passa. É esse
 * o ponto: deixar de perguntar "está no código?" e passar a perguntar "é utilizável?".
 */
export async function avaliarAptidaoDaFase(phaseKey: string, db: DB = prisma): Promise<AptidaoDaFase> {
  const canonica = EQUIVALENCIA_LEGADA[phaseKey]
  if (canonica) {
    return {
      apta: false, escopo: null, code: "CHAVE_LEGADA", canonica,
      motivo: `"${phaseKey}" é a chave antiga de "${canonica}". Use a fase canônica — a antiga produz um fluxo que o motor não resolve.`,
    }
  }
  const doCodigo = escopoCanonicoDaFase(phaseKey)
  if (doCodigo) return { apta: true, escopo: doCodigo, motivo: null, code: "OK" }

  const cadastro = await db.catalogoFase.findUnique({ where: { phaseKey }, select: { escopo: true, label: true } })
  if (!cadastro) {
    return { apta: false, escopo: null, code: "INEXISTENTE", motivo: `Não existe fase com a chave "${phaseKey}" no cadastro.` }
  }
  if (!cadastro.escopo) {
    return {
      apta: false, escopo: null, code: "SEM_ESCOPO",
      motivo: `A fase "${cadastro.label}" não declarou sobre o que opera (processo, pessoa, necessidade ou documento). Defina o escopo em Processos › Estrutura › Fases antes de usá-la num fluxo.`,
    }
  }
  return { apta: true, escopo: cadastro.escopo as EscopoOperacional, motivo: null, code: "OK" }
}
