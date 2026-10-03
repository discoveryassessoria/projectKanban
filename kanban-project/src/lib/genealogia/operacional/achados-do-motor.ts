// src/lib/genealogia/operacional/achados-do-motor.ts
//
// ACHADOS DO MOTOR GENEALÓGICO — a fonte ÚNICA do que o motor aponta como
// pendência da ÁRVORE (e não do trabalho).
//
// Nasceu quando o painel "Diagnóstico" saiu da tela (Etapa 2 da reforma da
// árvore): ele era o único lugar que listava `analise.insights` como pendência
// acionável — filho em comum sem união registrada, divergência de sobrenome
// entre gerações, duplicidade, conflito de datas, risco de linhagem. Esses
// achados NÃO podem se perder com o painel. Agora:
//
//   • `diagnostico.ts` (Próxima ação) lê DAQUI — não filtra insight por conta
//     própria;
//   • a aba Operação da pessoa lista DAQUI ("Divergências do motor");
//   • a Etapa 4 (fila final) consome a mesma função.
//
// Quais categorias do motor são pendência de árvore: conflito, duplicidade,
// relação e risco. `lacuna`, `pesquisa` e `migracao` NÃO são pendência — são
// sugestão/cadastro incompleto.
//
// `sobrenome` (divergência de nome/sobrenome entre gerações) também FICA DE FORA
// por decisão de produto (02/10/2026): o motor continua detectando
// (`motor/regras/linhagem.ts`), mas nenhuma tela da árvore exibe nem conta isso.
// Quando a fase Análise Documental for construída, é ela que consome. Para
// religar, basta incluir "sobrenome" aqui e em `CATEGORIAS_DIVERGENCIA` (dossie.ts).
//
// REGRA PERMANENTE (mesma da Etapa 2): tarefa vencida/aberta/com dono NUNCA é
// achado de árvore. Tarefa é trabalho em andamento — já tem lugar na Torre e em
// Tarefas. Este módulo só conhece `Insight`, que é fato do motor genealógico;
// não há como uma tarefa entrar aqui.
//
// PURO: sem prisma, sem rede, sem relógio.

import type { AnaliseArvore, CategoriaInsight, Insight, Severidade } from "../motor/tipos"

export type CategoriaAchado = "divergencia" | "duplicidade" | "relacao" | "linhagem"

export const ROTULO_CATEGORIA_ACHADO: Record<CategoriaAchado, string> = {
  divergencia: "Divergência de dados",
  duplicidade: "Possível duplicidade",
  relacao: "Relação incompleta",
  linhagem: "Linhagem",
}

export const FONTE_ACHADO_DO_MOTOR = "Motor genealógico (regra determinística)"

/** Categorias do motor que valem como pendência de árvore. */
export const CATEGORIAS_ACHADO: ReadonlySet<CategoriaInsight> = new Set<CategoriaInsight>([
  "conflito",
  "duplicidade",
  "relacao",
  "risco",
])

export interface AchadoDoMotor {
  /** Id do insight de origem (estável entre leituras da mesma árvore). */
  id: string
  categoria: CategoriaAchado
  /** Severidade do motor, sem reclassificar — segunda opinião seria outra verdade. */
  severidade: Severidade
  /** Só o que o motor classificou como crítico impede; o resto atrasa. */
  impeditivo: boolean
  titulo: string
  explicacao: string
  /** Próximo passo concreto. Nunca vazio. */
  acao: string
  /** Todas as pessoas que o achado toca (pode ser vazio: achado da árvore toda). */
  pessoaIds: number[]
  /** Pessoa-alvo do clique: a primeira que o achado toca (ou a do escopo, se houver). */
  pessoaId: number | null
  fonte: string
  /** Peso do motor (já considera impacto na linha de cidadania). */
  peso: number
}

/** Categoria de pendência do insight, ou null quando ele não é pendência de árvore. */
export function categoriaDoAchado(i: Insight): CategoriaAchado | null {
  if (!CATEGORIAS_ACHADO.has(i.categoria)) return null
  switch (i.categoria) {
    case "conflito":
      return "divergencia"
    case "duplicidade":
      return "duplicidade"
    case "relacao":
      return "relacao"
    case "risco":
      return "linhagem"
    default:
      return null
  }
}

/**
 * Todos os achados do motor que são pendência de árvore, do mais pesado ao mais
 * leve (desempate por id — duas leituras da mesma árvore dão a mesma lista).
 *
 * `escopo` (opcional) restringe aos achados que tocam alguém do conjunto — ou
 * que não tocam ninguém (afetam a árvore inteira) — e escolhe como alvo a
 * primeira pessoa DO ESCOPO.
 */
export function achadosDoMotor(
  analise: Pick<AnaliseArvore, "insights"> | null | undefined,
  escopo?: ReadonlySet<number>,
): AchadoDoMotor[] {
  const saida: AchadoDoMotor[] = []
  for (const i of analise?.insights ?? []) {
    const categoria = categoriaDoAchado(i)
    if (!categoria) continue
    if (escopo && i.pessoaIds.length > 0 && !i.pessoaIds.some((id) => escopo.has(id))) continue

    const alvo = escopo
      ? (i.pessoaIds.find((id) => escopo.has(id)) ?? i.pessoaIds[0] ?? null)
      : (i.pessoaIds[0] ?? null)

    saida.push({
      id: i.id,
      categoria,
      severidade: i.severidade,
      impeditivo: i.severidade === "critico",
      titulo: i.titulo,
      explicacao: i.explicacao,
      acao: i.acao ?? "Abrir a pessoa e conferir o cadastro.",
      pessoaIds: [...i.pessoaIds],
      pessoaId: alvo,
      fonte: FONTE_ACHADO_DO_MOTOR,
      peso: i.peso,
    })
  }
  saida.sort((a, b) => b.peso - a.peso || a.id.localeCompare(b.id))
  return saida
}

/**
 * Achados agrupados por pessoa: cada achado aparece sob TODAS as pessoas que ele
 * toca (um filho em comum sem união aparece nos dois pais; uma duplicidade, nas
 * duas fichas). Achado sem pessoa não tem dono e fica fora do mapa — continua
 * acessível em `achadosDoMotor` e no painel de Análise.
 */
export function achadosDoMotorPorPessoa(
  analise: Pick<AnaliseArvore, "insights"> | null | undefined,
): Map<number, AchadoDoMotor[]> {
  const mapa = new Map<number, AchadoDoMotor[]>()
  for (const a of achadosDoMotor(analise)) {
    for (const id of a.pessoaIds) {
      const lista = mapa.get(id)
      if (lista) lista.push(a)
      else mapa.set(id, [a])
    }
  }
  return mapa
}
