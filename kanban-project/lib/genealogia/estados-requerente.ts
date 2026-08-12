// lib/genealogia/estados-requerente.ts
// ============================================================================
// CONTRATO DE DOMÍNIO — REQUERENTE DO PROCESSO × MEMBRO DA ÁRVORE.
//
// ─── A REGRA ────────────────────────────────────────────────────────────────
//   EXISTIR NO PROCESSO ≠ PARTICIPAR DA ÁRVORE.
//
// Um requerente pode ficar cadastrado no processo por um dia, um mês ou um ano
// sem nunca entrar na Árvore Genealógica. Isso é ESTADO LEGÍTIMO DE NEGÓCIO —
// não é pendência, não é inconsistência, não é corrupção, e não se "repara".
//
// O que dispara o ciclo genealógico é UMA transição explícita do usuário:
//   FORA_DA_ARVORE → NA_ARVORE
// e nunca a mera existência do cadastro.
//
// ─── POR QUE ISTO PRECISOU VIRAR CÓDIGO ─────────────────────────────────────
// Porque, escrito só em prosa, o contrato foi violado três vezes em três
// lugares diferentes: a rota que era dona do efeito (corrigido em 09/08), o
// motor econômico que não reconciliava a saída (corrigido em 08/08) e cinco
// consultas que contavam requerente por um vocabulário de flag próprio.
//
// Regra que vive num documento é combinada. Regra que vive num módulo, é lida
// por quem decide e é verificada por guard, é contrato.
//
// ─── O QUE ESTE MÓDULO É E O QUE NÃO É ──────────────────────────────────────
// É: a definição dos estados, das transições legítimas, do gatilho de cada uma
// e do que cada estado autoriza. PURO — sem Prisma, sem I/O.
// NÃO é: fonte do RECORTE de consulta. Quem diz "quem está ativo na árvore" em
// SQL é `src/lib/genealogia/vinculo-ativo.ts` (`requerentesAtivosDaArvore`), e
// há uma fonte só para isso.
// ============================================================================

/** Os quatro estados que um requerente pode ocupar em relação à árvore. */
export type EstadoRequerente =
  /** Cadastrado no processo. Sem nó na árvore. LEGÍTIMO e possivelmente definitivo. */
  | "FORA_DA_ARVORE"
  /** Nó ativo na árvore. É o único estado que autoriza efeito genealógico. */
  | "NA_ARVORE"
  /** Teve nó, saiu. Cadastro do processo PRESERVADO; efeitos sem causa reconciliados. */
  | "REMOVIDO_DA_ARVORE"
  /** Nem sequer é requerente deste processo. */
  | "FORA_DO_PROCESSO"

/** Os fatos observáveis que determinam o estado. Nada aqui é inferido. */
export interface FatosDoRequerente {
  /** Existe `ProcessoRequerente` ativo (removidoEm nulo)? */
  vinculadoAoProcesso: boolean
  /** Existe `Pessoa` correspondente com `arvoreId` da árvore do processo? */
  temNoNaArvore: boolean
  /** O nó existe mas está marcado como removido (`Pessoa.removidaEm`)? */
  noRemovido: boolean
  /** O nó carrega flag de requerente (`sim` | `maior` | `menor`)? */
  noMarcadoComoRequerente: boolean
}

/**
 * O estado, lido dos fatos — nunca de `Requerente.personId` sozinho.
 *
 * `personId` é o ponteiro de identidade e sobrevive à saída da árvore em um
 * caso (desativação) e é zerado em outro (hard delete). Tratá-lo como sinônimo
 * de membership é o erro que este módulo existe para impedir: ele responde
 * "quem é esta pessoa", não "ela participa da árvore".
 */
export function classificarEstado(f: FatosDoRequerente): EstadoRequerente {
  if (!f.vinculadoAoProcesso) return "FORA_DO_PROCESSO"
  if (f.temNoNaArvore && !f.noRemovido && f.noMarcadoComoRequerente) return "NA_ARVORE"
  if (f.temNoNaArvore && f.noRemovido) return "REMOVIDO_DA_ARVORE"
  return "FORA_DA_ARVORE"
}

/** O que cada estado AUTORIZA. Ausência de autorização é proibição. */
export interface EfeitosAutorizados {
  /** Necessidades documentais derivadas da participação genealógica. */
  documental: boolean
  /** Tarefas/passos derivados do membership. */
  workflow: boolean
  /** Receita/custo cujo GATILHO é a entrada na árvore. */
  financeiroGenealogico: boolean
  /** Aparecer na Central como efeito da árvore. */
  centralOperacional: boolean
  /** Entrar no cálculo de linhagem. */
  linhagem: boolean
}

const NENHUM: EfeitosAutorizados = {
  documental: false, workflow: false, financeiroGenealogico: false,
  centralOperacional: false, linhagem: false,
}
const TODOS: EfeitosAutorizados = {
  documental: true, workflow: true, financeiroGenealogico: true,
  centralOperacional: true, linhagem: true,
}

/**
 * A MATRIZ. Só `NA_ARVORE` autoriza efeito genealógico — nos outros três, o que
 * existir sem outra causa válida é órfão e a reconciliação retira.
 *
 * `REMOVIDO_DA_ARVORE` autorizar NADA não significa apagar tudo: significa que a
 * PARTICIPAÇÃO deixou de ser causa. Fato histórico protegido (pagamento, arquivo,
 * protocolo) é OUTRA causa, e é ela que preserva o registro — decisão do
 * reconciliador, não deste módulo.
 */
export const EFEITOS_POR_ESTADO: Record<EstadoRequerente, EfeitosAutorizados> = {
  FORA_DO_PROCESSO: NENHUM,
  FORA_DA_ARVORE: NENHUM,
  NA_ARVORE: TODOS,
  REMOVIDO_DA_ARVORE: NENHUM,
}

/** Uma transição de estado e o que a provoca. */
export interface Transicao {
  de: EstadoRequerente
  para: EstadoRequerente
  /** O ato do usuário. Nunca "o registro existe". */
  gatilho: string
  /** A função que é dona do ato. Não há segunda porta. */
  porta: string
  /** Evento de domínio publicado, quando há. */
  evento: string | null
}

/**
 * AS ÚNICAS TRANSIÇÕES LEGÍTIMAS. Qualquer caminho que produza uma mudança de
 * estado fora desta tabela é porta paralela.
 *
 * Repare no que NÃO está aqui: não existe transição cujo gatilho seja "cadastrar
 * requerente no processo". Cadastrar leva a `FORA_DA_ARVORE` — e para nele.
 */
export const TRANSICOES: readonly Transicao[] = [
  {
    de: "FORA_DO_PROCESSO", para: "FORA_DA_ARVORE",
    gatilho: "cadastrar o requerente no processo (ato administrativo)",
    porta: "PUT /api/processos/[id] · criar-processo",
    evento: null, // DE PROPÓSITO: cadastro não é gatilho genealógico.
  },
  {
    de: "FORA_DA_ARVORE", para: "NA_ARVORE",
    gatilho: "o usuário escolhe ADICIONAR À ÁRVORE",
    porta: "vincularRequerente (lib/genealogia/vincular-requerente)",
    evento: "requerente.adicionado",
  },
  {
    de: "NA_ARVORE", para: "REMOVIDO_DA_ARVORE",
    gatilho: "o usuário remove da árvore, havendo fato histórico protegido",
    porta: "removerPessoaDaArvore (modo DESATIVAR)",
    evento: null,
  },
  {
    de: "NA_ARVORE", para: "FORA_DA_ARVORE",
    gatilho: "o usuário remove da árvore, sem fato protegido",
    porta: "removerPessoaDaArvore (modo HARD)",
    evento: null,
  },
  {
    de: "REMOVIDO_DA_ARVORE", para: "NA_ARVORE",
    gatilho: "o usuário adiciona de novo à árvore",
    porta: "vincularRequerente (reativa o nó, não cria um segundo)",
    evento: "requerente.adicionado",
  },
] as const

/** A transição existe no contrato? */
export function transicaoPermitida(de: EstadoRequerente, para: EstadoRequerente): boolean {
  if (de === para) return true // no-op é sempre legítimo (idempotência)
  return TRANSICOES.some((t) => t.de === de && t.para === para)
}

/**
 * A resposta do Explain Engine para "por que esta pessoa não tem efeitos?".
 * Sai do estado e da matriz — nunca de suposição sobre o que o usuário quis.
 */
export function explicarEfeitos(estado: EstadoRequerente, nome: string): string {
  switch (estado) {
    case "NA_ARVORE":
      return `${nome} está na Árvore Genealógica deste processo. Os efeitos documentais, operacionais e financeiros aplicáveis são gerados a partir dessa participação.`
    case "FORA_DA_ARVORE":
      return `${nome} é requerente deste processo, mas ainda não foi adicionada à Árvore Genealógica. Os efeitos genealógicos só existem depois dessa entrada explícita — não há nada pendente nem errado neste estado.`
    case "REMOVIDO_DA_ARVORE":
      return `${nome} foi removida da Árvore Genealógica e continua sendo requerente deste processo. Os efeitos que dependiam exclusivamente da participação na árvore foram reconciliados; o que tem fato histórico próprio permanece.`
    case "FORA_DO_PROCESSO":
      return `${nome} não é requerente deste processo.`
  }
}
