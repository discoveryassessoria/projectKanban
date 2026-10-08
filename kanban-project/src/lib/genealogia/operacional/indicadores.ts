// src/lib/genealogia/operacional/indicadores.ts
//
// INDICADORES DA ÁRVORE — a fonte ÚNICA dos números que a árvore exibe.
//
// Havia três painéis dizendo coisas parecidas por três caminhos:
//
//   • o painel de Inteligência lia `analise.qualidade` e `analise.insights`;
//   • o cartão de resumo do requerente (`resumirLinhagem`) somava, pessoa a
//     pessoa, `dossie.divergencias` (conflito/duplicidade/sobrenome);
//   • a aba Operação listava `achadosDoMotor` (que inclui relação e risco).
//
// Resultado real: "Divergências" do cartão contava duas vezes o achado que toca
// duas pessoas da linha e ignorava relação/risco, enquanto a aba Operação listava
// esses mesmos achados. E a pergunta "O que falta?" somava `documental.necessarias`
// de cada pessoa, contando a certidão de casamento uma vez por cônjuge — número
// diferente do "Documentos X de Y" do cartão para a MESMA linha.
//
// Este módulo é a definição única:
//   • DIVERGÊNCIA = um achado do motor que é pendência de árvore
//     (`achados-do-motor.ts`), contado UMA vez por achado, não por pessoa;
//   • DOCUMENTOS = a projeção bruta do Sistema Documental, com cada união
//     contada uma vez (`consolidarDocumental`);
//   • QUALIDADE/COMPLETUDE/CONSISTÊNCIA/COBERTURA = `analise.qualidade.detalhe`,
//     produzido por `motor/qualidade.ts` junto com a decomposição.
//
// Os três painéis (Inteligência, cartão de resumo, aba Operação) e as perguntas
// consomem DAQUI. Nenhum recalcula. O teste `arvore-inteligencia-etapa5` prova
// "mesma entrada ⇒ mesmos números" e varre a fonte atrás de cálculo paralelo.
//
// PURO: sem prisma, sem rede, sem relógio.

import type { GrafoGenealogico } from "../motor/grafo"
import type { AnaliseArvore, DetalheQualidade } from "../motor/tipos"
import {
  indicadorVazio,
  ehDonoDaUniao,
  type IndicadorDocumental,
  type ProjecaoDocumental,
} from "../documental/indicadores"
import {
  achadosDoMotor,
  type AchadoDoMotor,
  type CategoriaAchado,
} from "./achados-do-motor"

// ── DOCUMENTOS ──────────────────────────────────────────────────────────────

/** Uniões de uma pessoa — a certidão de casamento é exigida da união. */
export function uniaoIdsDe(g: GrafoGenealogico, pessoaId: number): number[] {
  return g
    .unioesDe(pessoaId)
    .map((u) => u.id)
    .filter((id): id is number => typeof id === "number")
}

/** Soma todos os campos numéricos de `fonte` em `alvo`, in place. */
function somarIndicadorEm(alvo: IndicadorDocumental, fonte: IndicadorDocumental): void {
  alvo.necessarias += fonte.necessarias
  alvo.atendidas += fonte.atendidas
  alvo.emAtendimento += fonte.emAtendimento
  alvo.pendentes += fonte.pendentes
  alvo.naoLocalizadas += fonte.naoLocalizadas
  alvo.dispensadas += fonte.dispensadas
  alvo.opcionais += fonte.opcionais
}

/**
 * Consolidado documental de um CONJUNTO de pessoas. Parte pessoal de cada uma +
 * cada união exatamente uma vez: `indicadorDaPessoa` já funde a união no cartão
 * individual, então somar isso por cônjuge contaria a MESMA certidão de
 * casamento duas vezes (achado real 24/09/2026: 5 casamentos inflavam +5).
 */
export function consolidarDocumental(
  ids: Iterable<number>,
  grafo: GrafoGenealogico,
  projecao: ProjecaoDocumental,
): IndicadorDocumental {
  const documental = indicadorVazio()
  const uniõesContadas = new Set<number>()
  for (const id of ids) {
    const pessoal = projecao.porPessoa.get(id)
    if (pessoal) somarIndicadorEm(documental, pessoal)
    for (const uid of uniaoIdsDe(grafo, id)) {
      if (uniõesContadas.has(uid)) continue
      // Só o DONO da certidão leva a união: um cônjuge dispensado do conjunto não a puxa.
      if (!ehDonoDaUniao(projecao, uid, id)) continue
      uniõesContadas.add(uid)
      const uniao = projecao.porUniao.get(uid)
      if (uniao) somarIndicadorEm(documental, uniao)
    }
  }
  const resolvidas = documental.atendidas + documental.dispensadas
  documental.progresso =
    documental.necessarias > 0 ? Math.round((resolvidas / documental.necessarias) * 100) : null
  documental.situacao =
    documental.necessarias === 0
      ? "sem_exigencia"
      : documental.naoLocalizadas > 0
        ? "bloqueado"
        : documental.pendentes > 0
          ? "pendente"
          : documental.emAtendimento > 0
            ? "em_andamento"
            : "completo"
  return documental
}

// ── DIVERGÊNCIAS ────────────────────────────────────────────────────────────

export interface IndicadorDivergencias {
  /** Achados do motor que são pendência de árvore — um por achado. */
  total: number
  /** Os que o motor classificou como críticos (impedem). */
  impeditivas: number
  porCategoria: Record<CategoriaAchado, number>
  /** A lista exata que forma o número, do mais pesado ao mais leve. */
  itens: AchadoDoMotor[]
  /**
   * true quando o motor cortou a lista de exibição (teto por categoria): a
   * contagem cobre só o que sobrou, e quem exibe precisa dizer isso.
   */
  parcial: boolean
}

export function indicadorDeDivergencias(
  analise: Pick<AnaliseArvore, "insights" | "truncado"> | null | undefined,
  escopo?: ReadonlySet<number>,
): IndicadorDivergencias {
  const itens = achadosDoMotor(analise, escopo)
  const porCategoria: Record<CategoriaAchado, number> = {
    divergencia: 0,
    duplicidade: 0,
    relacao: 0,
    linhagem: 0,
  }
  for (const a of itens) porCategoria[a.categoria]++
  return {
    total: itens.length,
    impeditivas: itens.filter((a) => a.impeditivo).length,
    porCategoria,
    itens,
    parcial: Boolean(analise?.truncado),
  }
}

// ── POR ESCOPO (linhagem ou árvore inteira) ─────────────────────────────────

export interface IndicadoresDoEscopo {
  documental: IndicadorDocumental
  divergencias: IndicadorDivergencias
}

/** Números de um conjunto de pessoas — o que o cartão de resumo mostra. */
export function indicadoresDoEscopo(args: {
  ids: ReadonlySet<number>
  grafo: GrafoGenealogico
  analise: Pick<AnaliseArvore, "insights" | "truncado"> | null
  projecao: ProjecaoDocumental
}): IndicadoresDoEscopo {
  return {
    documental: consolidarDocumental(args.ids, args.grafo, args.projecao),
    divergencias: indicadorDeDivergencias(args.analise, args.ids),
  }
}

// ── POR PESSOA (aba Operação) ───────────────────────────────────────────────

export interface IndicadoresDaPessoa {
  documental: IndicadorDocumental
  divergencias: number
}

/**
 * Números de UMA pessoa. `achadosDaPessoa` é a mesma lista que a fila lista —
 * contar e listar saem do mesmo array, então a aba não pode dizer "2" e mostrar 3.
 */
export function indicadoresDaPessoa(
  documental: IndicadorDocumental,
  achadosDaPessoa: readonly AchadoDoMotor[],
): IndicadoresDaPessoa {
  return { documental, divergencias: achadosDaPessoa.length }
}

// ── ÁRVORE INTEIRA (painel de Inteligência) ─────────────────────────────────

export interface IndicadoresDaArvore {
  /** As quatro porcentagens, cada uma com a conta que a produziu. */
  qualidade: DetalheQualidade
  /** Divergências da árvore INTEIRA (o cartão mostra as da linhagem em foco). */
  divergencias: IndicadorDivergencias
  totalPessoas: number
  pessoasNaLinha: number
  /** Achados do motor de TODAS as categorias, antes do corte de exibição. */
  totalAchados: number
}

export function indicadoresDaArvore(analise: AnaliseArvore): IndicadoresDaArvore {
  return {
    qualidade: analise.qualidade.detalhe,
    divergencias: indicadorDeDivergencias(analise),
    totalPessoas: analise.qualidade.totalPessoas,
    pessoasNaLinha: analise.linhaCidadania.length,
    totalAchados: Object.values(analise.totais).reduce((s, n) => s + n, 0),
  }
}
