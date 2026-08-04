// src/lib/process-stage/pendencias-transversais-core.ts
//
// PENDÊNCIAS TRANSVERSAIS — núcleo PURO (sem prisma, sem I/O).
//
// A posição do card no Kanban não é prova de conclusão. Um processo pode estar em
// Tradução e continuar devendo trabalho na Emissão e na Análise: mover não conclui,
// não cancela e não dispensa nada. Este núcleo transforma o estado REAL das
// obrigações (passo a passo, ciclo a ciclo) num resumo por fase, classificado em
// relação à fase operacional de referência.
//
// É DERIVADO: nada aqui é persistido, e ninguém consulta isto para decidir o gate da
// fase atual (isso é da projeção operacional canônica). Segunda fonte de verdade não
// se cria — se deriva.

/** Passo de workflow, reduzido ao que importa para a contagem. */
export interface PassoParaPendencia {
  faseMacroKey: string
  ciclo: number
  status: string
  obrigatorio: boolean
  /** Status da instância de fase a que ele pertence. */
  statusDaInstancia: string
}

export interface FaseOrdenadaSimples {
  phaseKey: string
  ordem: number
  label: string
}

export type PosicaoRelativa = "ANTERIOR" | "ATUAL" | "POSTERIOR" | "FORA_DO_MACRO"

export interface PendenciaDaFase {
  phaseKey: string
  label: string
  ordem: number
  posicao: PosicaoRelativa
  /** Obrigações obrigatórias ainda devidas nesta fase (somando todos os ciclos). */
  pendentes: number
  /** Obrigações já encerradas (concluídas, dispensadas ou supersedidas). */
  encerradas: number
  ciclos: number
  /** Há pendência em ciclo que não é mais a referência operacional da fase. */
  temPendenciaEmCicloSupersedido: boolean
}

export interface ResumoPendenciasTransversais {
  faseAtualKey: string | null
  totalPendentes: number
  pendentesAnteriores: number
  pendentesNaFaseAtual: number
  pendentesPosteriores: number
  fasesComPendencia: number
  /** Uma linha por fase COM materialização — na ordem do macro. */
  porFase: PendenciaDaFase[]
  /**
   * O processo tem obrigação devida em qualquer fase. Enquanto for `true`, chegar à
   * última fase NÃO significa processo concluído.
   */
  temPendenciaTransversal: boolean
}

/** Passo encerrado: o trabalho dele não é mais devido. */
const ENCERRADO = new Set(["CONCLUIDO", "DISPENSADO", "SUPERSEDIDO", "CANCELADO"])
/** Ciclo que deixou de ser a referência operacional — mas cujas obrigações continuam válidas. */
const CICLO_FORA_DA_REFERENCIA = new Set(["SUPERSEDIDO", "CANCELADO"])

export function montarPendenciasTransversais(
  passos: PassoParaPendencia[],
  fases: FaseOrdenadaSimples[],
  faseAtualKey: string | null,
): ResumoPendenciasTransversais {
  const ordemPorFase = new Map(fases.map((f) => [f.phaseKey, f.ordem]))
  const labelPorFase = new Map(fases.map((f) => [f.phaseKey, f.label]))
  const ordemAtual = faseAtualKey != null ? ordemPorFase.get(faseAtualKey) ?? null : null

  const posicaoDe = (phaseKey: string): PosicaoRelativa => {
    const ordem = ordemPorFase.get(phaseKey)
    if (ordem == null) return "FORA_DO_MACRO"
    if (ordemAtual == null) return "POSTERIOR"
    if (phaseKey === faseAtualKey) return "ATUAL"
    return ordem < ordemAtual ? "ANTERIOR" : "POSTERIOR"
  }

  const acc = new Map<string, PendenciaDaFase & { ciclosVistos: Set<number> }>()
  for (const p of passos) {
    let linha = acc.get(p.faseMacroKey)
    if (!linha) {
      linha = {
        phaseKey: p.faseMacroKey,
        label: labelPorFase.get(p.faseMacroKey) ?? p.faseMacroKey,
        ordem: ordemPorFase.get(p.faseMacroKey) ?? Number.MAX_SAFE_INTEGER,
        posicao: posicaoDe(p.faseMacroKey),
        pendentes: 0, encerradas: 0, ciclos: 0,
        temPendenciaEmCicloSupersedido: false,
        ciclosVistos: new Set<number>(),
      }
      acc.set(p.faseMacroKey, linha)
    }
    linha.ciclosVistos.add(p.ciclo)

    // SUPERSEDIDO no CICLO não encerra a OBRIGAÇÃO. O que decide se o trabalho ainda
    // é devido é o status do PASSO — nunca a posição do card nem o status do ciclo.
    if (!p.obrigatorio) continue
    if (ENCERRADO.has(p.status)) { linha.encerradas++; continue }
    linha.pendentes++
    if (CICLO_FORA_DA_REFERENCIA.has(p.statusDaInstancia)) linha.temPendenciaEmCicloSupersedido = true
  }

  const porFase = [...acc.values()]
    .map(({ ciclosVistos, ...linha }) => ({ ...linha, ciclos: ciclosVistos.size }))
    .sort((a, b) => a.ordem - b.ordem)

  const somar = (posicao: PosicaoRelativa) =>
    porFase.filter((f) => f.posicao === posicao).reduce((s, f) => s + f.pendentes, 0)

  const totalPendentes = porFase.reduce((s, f) => s + f.pendentes, 0)

  return {
    faseAtualKey,
    totalPendentes,
    pendentesAnteriores: somar("ANTERIOR"),
    pendentesNaFaseAtual: somar("ATUAL"),
    // Fase fora do macro é trabalho materializado que o workflow atual não conhece:
    // continua devido, e some se for contado como "nenhum lugar".
    pendentesPosteriores: somar("POSTERIOR") + somar("FORA_DO_MACRO"),
    fasesComPendencia: porFase.filter((f) => f.pendentes > 0).length,
    porFase,
    temPendenciaTransversal: totalPendentes > 0,
  }
}
