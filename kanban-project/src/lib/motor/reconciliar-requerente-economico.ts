// src/lib/motor/reconciliar-requerente-economico.ts
// ============================================================================
// RECONCILIAÇÃO do efeito econômico POR REQUERENTE — o inverso que faltava.
//
// ─── O DEFEITO QUE ESTE ARQUIVO CORRIGE ─────────────────────────────────────
// `processarRequerenteAdicionado` (executor.ts) transforma a entrada de uma
// pessoa na árvore em quatro linhas: Receita, ReceitaRequerente, MotorArtefato e
// — pelo dual-write — ObrigacaoEconomica + Ledger. Existia o ADICIONAR e não
// existia o RETIRAR: nenhum evento `requerente.removido`, nenhum reconciliador.
//
// `reconciliarEconomicoDoProcesso` parecia cobrir o caso, mas filtra
// `ruleSource: 'matriz'`. O efeito por requerente grava `ruleSource: 'automation'`
// e NUNCA era visitado. A remoção da pessoa só alcançava o que estivesse ligado
// por `Receita.personId` — a coluna que o próprio apagamento zera (SetNull).
//
// MEDIDO EM PRODUÇÃO (processo 513 "Abellan", 08/08/2026):
//   Receita 180  R$ 2.800  ATIVA   causa = pessoa 2646 (apagada)   personId=null
//   Obrigação 16 R$ 2.800  ATIVO   espelho da Receita 209, que já não existe
//   Obrigação 18 R$ 2.000  ATIVO   espelho da Receita 211, que já não existe
//   Artefatos 231/236/238 'active' apontando para receita órfã ou inexistente
// Total: R$ 6.800 de receita sem causa viva, somando no Financeiro e exibida
// como "Requerente não identificado".
//
// ─── COMO ESTE RECONCILIADOR DECIDE ─────────────────────────────────────────
// Nunca por tabela, sempre por CAUSA:
//
//   causa válida  = requerente ATIVO da árvore (vinculo-ativo, mesma régua que a
//                   criação usa para ordenar e classificar);
//   causa do efeito = lib/financeiro/causa-requerente (chave de idempotência e
//                   contexto — proveniência que nenhuma FK apaga);
//
//   causa viva            → PRESERVAR;
//   causa perdida + fato  → PRESERVAR (o fato é outra causa válida) e RELATAR;
//   causa perdida, sem fato → RETIRAR pelo dono do domínio.
//
// Quem retira é `lib/financeiro/acoes/excluir-receita` — o serviço que já
// responde por "tirar da operação sem apagar o Ledger". Este arquivo não apaga
// linha de financeiro por conta própria: decide QUEM perdeu a causa e chama o
// dono. Nenhuma tabela de outro domínio é tocada daqui.
//
// IDEMPOTENTE: retirada é marca (exclusão lógica / arquivamento), não delete.
// A segunda execução não encontra candidato e não escreve nada.
// ============================================================================

import { prisma } from "@/lib/prisma"
import { requerentesAtivosDaArvore } from "@/src/lib/genealogia/vinculo-ativo"
import {
  pessoaCausadoraDaReceita,
  pessoaCausadoraDoArtefato,
  RULE_SOURCE_POR_REQUERENTE,
} from "@/lib/financeiro/causa-requerente"
import { temMarcaExclusao } from "@/lib/financeiro/leitura/exclusao-filtro"
import { podeExcluir, excluirReceita } from "@/lib/financeiro/acoes/excluir-receita"

/** O que a reconciliação decidiu para UM efeito derivado. */
export type AcaoReconciliacao =
  | "PRESERVAR_CAUSA_VIVA"
  | "PRESERVAR_FATO_PROTEGIDO"
  | "PRESERVAR_SEM_PROVENIENCIA"
  | "RETIRAR_RECEITA_ORFA"
  | "ARQUIVAR_ESPELHO_ORFAO"
  | "ENCERRAR_ARTEFATO"

export interface EfeitoReconciliado {
  acao: AcaoReconciliacao
  /** Entidade concreta a que a ação se aplica. */
  entidade: "Receita" | "ObrigacaoEconomica" | "MotorArtefato"
  entidadeId: number
  /** Pessoa que causou o efeito, quando a proveniência permite dizer. */
  causaPessoaId: number | null
  /** Quantas causas válidas restam para este efeito. 0 ⇒ candidato à retirada. */
  causasRestantes: number
  estadoAtual: string
  estadoDesejado: string
  descricao: string
  valor: number | null
  moeda: string | null
  /** Fatos que impedem a retirada (vazio quando a ação é retirar). */
  fatos: string[]
  /** Executado de fato? `false` em dry-run e quando a ação é preservar. */
  aplicado: boolean
  erro?: string
}

export interface RelatorioReconciliacaoRequerente {
  processoId: number
  arvoreId: number | null
  dryRun: boolean
  /** pessoaIds que AINDA são causa válida (requerentes ativos da árvore). */
  causasValidas: number[]
  efeitos: EfeitoReconciliado[]
  resumo: {
    avaliados: number
    preservados: number
    retirados: number
    arquivados: number
    artefatosEncerrados: number
    bloqueadosPorFato: number
    erros: number
  }
}

const num = (v: unknown): number | null => (v == null ? null : Number(v))

/**
 * Reconcilia o efeito econômico por requerente de UM processo.
 *
 * `dryRun: true` (padrão) NÃO escreve nada: devolve exatamente o mesmo plano que
 * a execução aplicaria. É o relatório que antecede qualquer reparo em produção.
 */
export async function reconciliarAutomacaoPorRequerente(
  processoId: number,
  opts: { dryRun?: boolean; usuarioId?: number | null; motivo?: string | null } = {},
): Promise<RelatorioReconciliacaoRequerente> {
  const dryRun = opts.dryRun ?? true
  const motivo =
    opts.motivo ??
    "Reconciliação: o requerente que originava este lançamento não está mais na árvore do processo."

  const efeitos: EfeitoReconciliado[] = []

  const processo = await prisma.processo.findUnique({
    where: { id: processoId },
    select: { id: true, arvoreId: true },
  })
  if (!processo) {
    return {
      processoId, arvoreId: null, dryRun, causasValidas: [], efeitos,
      resumo: { avaliados: 0, preservados: 0, retirados: 0, arquivados: 0, artefatosEncerrados: 0, bloqueadosPorFato: 0, erros: 0 },
    }
  }

  // ── CAUSAS VÁLIDAS ────────────────────────────────────────────────────────
  // Requerentes ATIVOS da árvore. Mesma régua da criação — importada, não repetida.
  const vivos = processo.arvoreId
    ? await prisma.pessoa.findMany({
        where: requerentesAtivosDaArvore(processo.arvoreId),
        select: { id: true },
      })
    : []
  const causasValidas = new Set(vivos.map((p) => p.id))

  // ── UNIVERSO ──────────────────────────────────────────────────────────────
  const receitas = await prisma.receita.findMany({
    where: { processoId },
    select: {
      id: true, codigo: true, descricao: true, valor: true, moeda: true, status: true,
      personId: true, chaveIdempotencia: true, contextoAplicado: true, arquivadaEm: true,
    },
  })
  const receitaPor = new Map(receitas.map((r) => [r.id, r]))

  const obrigacoes = await prisma.obrigacaoEconomica.findMany({
    where: { processoId, origemTipo: "Receita" },
    select: { id: true, origemId: true, valorContratado: true, moedaContratual: true, status: true, arquivadaEm: true, codigoOperacional: true },
  })

  const artefatos = await prisma.motorArtefato.findMany({
    where: {
      processoId,
      ruleKind: "financial",
      ruleSource: { in: [...RULE_SOURCE_POR_REQUERENTE] },
      status: "active",
    },
    select: { id: true, automaticKey: true, ruleSource: true, detalhes: true, targetTable: true, targetId: true, descricao: true },
  })

  // Obrigações a retirar, indexadas para não decidir a mesma linha duas vezes.
  const jaTratada = new Set<number>()
  // Receitas que ESTA execução retira. Em dry-run nada é escrito, então o passo 3
  // não pode perguntar ao banco se a receita já saiu — perguntaria e ouviria "não",
  // e o plano esconderia o encerramento do artefato que a execução faria.
  const retiradasNestaExecucao = new Set<number>()

  // ── 1) RECEITA COM CAUSA PERDIDA ──────────────────────────────────────────
  for (const r of receitas) {
    const causa = pessoaCausadoraDaReceita(r)
    if (causa == null) continue // sem proveniência de requerente: não é deste reconciliador
    const viva = causasValidas.has(causa)
    const jaRetirada = temMarcaExclusao(r.contextoAplicado) || r.arquivadaEm != null || r.status === "CANCELADA"

    if (viva) {
      efeitos.push({
        acao: "PRESERVAR_CAUSA_VIVA", entidade: "Receita", entidadeId: r.id, causaPessoaId: causa,
        causasRestantes: 1, estadoAtual: String(r.status), estadoDesejado: String(r.status),
        descricao: r.descricao, valor: num(r.valor), moeda: String(r.moeda), fatos: [], aplicado: false,
      })
      continue
    }
    if (jaRetirada) continue // convergido: idempotência

    const espelhos = obrigacoes.filter((o) => o.origemId === r.id && o.arquivadaEm == null)
    // Sem espelho, a Receita ainda assim precisa sair da operação; usa a própria
    // Receita como referência para o dono resolver a obrigação (resolverId aceita).
    const refs = espelhos.length ? espelhos.map((o) => o.id) : [r.id]

    for (const ref of refs) {
      const checagem = await podeExcluir(String(ref)).catch((e) => ({
        permitido: false, motivos: [String((e as Error).message)], obrigacaoId: -1, receitaId: null as number | null,
      }))
      if (!checagem.permitido) {
        efeitos.push({
          acao: "PRESERVAR_FATO_PROTEGIDO", entidade: "Receita", entidadeId: r.id, causaPessoaId: causa,
          causasRestantes: 1, estadoAtual: `${r.status} · em operação`, estadoDesejado: `${r.status} · em operação`,
          descricao: r.descricao, valor: num(r.valor), moeda: String(r.moeda),
          fatos: checagem.motivos, aplicado: false,
        })
        if (checagem.obrigacaoId > 0) jaTratada.add(checagem.obrigacaoId)
        continue
      }
      const efeito: EfeitoReconciliado = {
        acao: "RETIRAR_RECEITA_ORFA", entidade: "Receita", entidadeId: r.id, causaPessoaId: causa,
        causasRestantes: 0, estadoAtual: "ATIVA · aparece no Financeiro",
        estadoDesejado: "excluída logicamente · fora da operação, Ledger preservado",
        descricao: r.descricao, valor: num(r.valor), moeda: String(r.moeda), fatos: [], aplicado: false,
      }
      if (!dryRun) {
        try {
          await excluirReceita(String(ref), { usuarioId: opts.usuarioId ?? null, motivo })
          efeito.aplicado = true
        } catch (e) {
          efeito.erro = (e as Error).message
        }
      }
      jaTratada.add(checagem.obrigacaoId)
      if (!efeito.erro) retiradasNestaExecucao.add(r.id)
      efeitos.push(efeito)
    }
  }

  // ── 2) ESPELHO ÓRFÃO — obrigação cuja Receita de origem não existe mais ────
  // O espelho V3 guarda `origemId` como coluna solta (sem FK): apagar a Receita
  // deixa a obrigação viva, ATIVA e sem nome de participante. A sua ÚNICA causa é
  // a Receita que ela espelha; sem ela, causas restantes = 0.
  for (const o of obrigacoes) {
    if (o.arquivadaEm != null || jaTratada.has(o.id)) continue
    if (o.origemId == null || receitaPor.has(o.origemId)) continue

    const checagem = await podeExcluir(String(o.id)).catch((e) => ({
      permitido: false, motivos: [String((e as Error).message)], obrigacaoId: o.id, receitaId: null as number | null,
    }))
    if (!checagem.permitido) {
      efeitos.push({
        acao: "PRESERVAR_FATO_PROTEGIDO", entidade: "ObrigacaoEconomica", entidadeId: o.id, causaPessoaId: null,
        causasRestantes: 1, estadoAtual: `${o.status} · em operação`, estadoDesejado: `${o.status} · em operação`,
        descricao: `${o.codigoOperacional ?? "obrigação"} — espelho da Receita ${o.origemId} (inexistente)`,
        valor: num(o.valorContratado), moeda: String(o.moedaContratual), fatos: checagem.motivos, aplicado: false,
      })
      continue
    }
    const efeito: EfeitoReconciliado = {
      acao: "ARQUIVAR_ESPELHO_ORFAO", entidade: "ObrigacaoEconomica", entidadeId: o.id, causaPessoaId: null,
      causasRestantes: 0, estadoAtual: "ATIVO · aparece no Financeiro sem requerente",
      estadoDesejado: "arquivado · fora da operação, Ledger preservado",
      descricao: `${o.codigoOperacional ?? "obrigação"} — espelho da Receita ${o.origemId}, que não existe mais`,
      valor: num(o.valorContratado), moeda: String(o.moedaContratual), fatos: [], aplicado: false,
    }
    if (!dryRun) {
      try {
        await excluirReceita(String(o.id), { usuarioId: opts.usuarioId ?? null, motivo })
        efeito.aplicado = true
      } catch (e) {
        efeito.erro = (e as Error).message
      }
    }
    efeitos.push(efeito)
  }

  // ── 3) ARTEFATO SEM CAUSA — encerra a marca de idempotência ───────────────
  // O artefato é a prova de que o efeito foi criado. Encerrá-lo (status 'removed')
  // é o que permite ao motor RECRIAR o efeito se a mesma pessoa voltar: enquanto
  // ele estiver 'active', `processarRequerenteAdicionado` considera o lançamento
  // existente e não faz nada. O artefato NÃO é apagado — a proveniência fica.
  for (const a of artefatos) {
    const causa = pessoaCausadoraDoArtefato(a)
    if (causa == null) {
      efeitos.push({
        acao: "PRESERVAR_SEM_PROVENIENCIA", entidade: "MotorArtefato", entidadeId: a.id, causaPessoaId: null,
        causasRestantes: 1, estadoAtual: "active", estadoDesejado: "active",
        descricao: a.descricao ?? a.automaticKey, valor: null, moeda: null,
        fatos: ["sem proveniência de requerente na chave — não se remove o que não se sabe atribuir"],
        aplicado: false,
      })
      continue
    }
    if (causasValidas.has(causa)) continue // causa viva: artefato permanece ativo

    const alvoVivo =
      a.targetTable === "Receita" && a.targetId != null && receitaPor.has(a.targetId)
        ? receitaPor.get(a.targetId)!
        : null
    // Alvo ainda operacional ⇒ a retirada acima falhou (fato protegido): o artefato
    // acompanha o lançamento e permanece ativo. Encerrar aqui mentiria sobre o estado.
    const alvoSaiu =
      alvoVivo == null ||
      retiradasNestaExecucao.has(alvoVivo.id) ||
      temMarcaExclusao(alvoVivo.contextoAplicado) ||
      alvoVivo.arquivadaEm != null
    if (!alvoSaiu) continue

    const efeito: EfeitoReconciliado = {
      acao: "ENCERRAR_ARTEFATO", entidade: "MotorArtefato", entidadeId: a.id, causaPessoaId: causa,
      causasRestantes: 0, estadoAtual: "active", estadoDesejado: "removed",
      descricao: a.descricao ?? a.automaticKey, valor: null, moeda: null, fatos: [], aplicado: false,
    }
    if (!dryRun) {
      try {
        await prisma.motorArtefato.update({ where: { id: a.id }, data: { status: "removed" } })
        efeito.aplicado = true
      } catch (e) {
        efeito.erro = (e as Error).message
      }
    }
    efeitos.push(efeito)
  }

  const resumo = {
    avaliados: efeitos.length,
    preservados: efeitos.filter((e) => e.acao.startsWith("PRESERVAR")).length,
    retirados: efeitos.filter((e) => e.acao === "RETIRAR_RECEITA_ORFA").length,
    arquivados: efeitos.filter((e) => e.acao === "ARQUIVAR_ESPELHO_ORFAO").length,
    artefatosEncerrados: efeitos.filter((e) => e.acao === "ENCERRAR_ARTEFATO").length,
    bloqueadosPorFato: efeitos.filter((e) => e.acao === "PRESERVAR_FATO_PROTEGIDO").length,
    erros: efeitos.filter((e) => e.erro).length,
  }

  return { processoId, arvoreId: processo.arvoreId, dryRun, causasValidas: [...causasValidas], efeitos, resumo }
}
