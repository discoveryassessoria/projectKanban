// src/services/financeiro/reconciliacao-documental-financeira.ts
// ============================================================================
// RECONCILIAÇÃO DA CADEIA DOCUMENTAL-FINANCEIRA.
//
// A pergunta que ela responde: "todo documento cujo registro está localizado tem
// os custos que a configuração vigente manda ter — e nada além disso?"
//
// O QUE ELA NUNCA FAZ
// -------------------
// Não inventa valor, não escolhe serviço, não cria cadastro, não classifica
// retroativamente origem e não apaga custo pago. Caso ambíguo é RELATADO, não
// resolvido: um relatório honesto vale mais que um reparo adivinhado.
//
// O QUE ELA REPARA (só em `--execute`, e só o determinístico)
// ----------------------------------------------------------
// Documento localizado, com regra e preço vigentes, e sem o lançamento
// correspondente: cria o que faltava, com a MESMA chave idempotente que o evento
// teria usado — por isso repor não duplica e reprocessar é inócuo. A origem fica
// declarada como BACKFILL_DOCUMENTAL, distinta do que nasceu pelo evento.
// ============================================================================

import { prisma } from "@/lib/prisma"
import { gerarEconomicoDaMatriz } from "@/src/lib/motor/matriz-economica"
import { resolverElegibilidadeDocumental } from "@/src/lib/motor/elegibilidade-documental"
import { resolverPrecoPorConfigDB } from "@/src/lib/motor/resolver-preco-financeiro.prisma"
import { NaturezaPreco } from "@prisma/client"
import { documentoEstaLocalizado } from "@/src/services/processEngine/stepCompletionResolver"
import { resolveWorkflowStepEditor } from "@/src/lib/process-stage/step-editor-registry"
import { ORIGEM_BACKFILL } from "@/lib/financeiro/dominio/origem-lancamento"
import { EVENTO_ORIGEM_PASSO } from "./projecao-documental"

/** Achado da reconciliação. `reparavel` = determinístico o bastante para o backfill. */
export interface AchadoReconciliacao {
  tipo:
    | "CUSTO_AUSENTE"          // documento localizado, regra vigente, sem lançamento
    | "CUSTO_DUPLICADO"        // duas obrigações ativas para a mesma célula
    | "CUSTO_SEM_DOCUMENTO"    // custo automático sem vínculo documental
    | "CUSTO_SEM_SERVICO"      // custo com documento e sem serviço
    | "CUSTO_SEM_TABELA"       // lançado sem regra de preço congelada
    | "CUSTO_SEM_CAMBIO"       // moeda estrangeira sem cotação para converter
    | "ORIGEM_NAO_CLASSIFICADA"// anterior à declaração de origem
    | "SEM_REGRA_NA_MATRIZ"    // documento localizado e nenhuma regra o cobre
    | "REGRA_SEM_TIPO_DOCUMENTAL" // regra aponta para código sem Tipo de Documento cadastrado
    | "SEM_REGRA_ECONOMICA"    // matriz manda, mas não há componente configurado
    | "CONDICAO_NAO_SATISFEITA"// a condição declarada na regra não vale p/ esta pessoa
    | "NAO_ELEGIVEL"           // o motor não geraria — motivo nomeado, sem promessa de reparo
    | "SEM_PRECO_VIGENTE"      // componente configurado, sem preço na vigência
  processoId: number | null
  personId: number | null
  documentoId: number | null
  tipoServicoId: number | null
  obrigacaoId: number | null
  stepInstanceId: number | null
  detalhe: string
  reparavel: boolean
}

export interface RelatorioReconciliacao {
  processos: number
  documentosLocalizados: number
  achados: AchadoReconciliacao[]
  reparados: number
  /** achados que exigem decisão humana (cadastro ausente, duplicidade real…) */
  ambiguos: number
}

interface Opcoes {
  processoId?: number | null
  /** false (padrão) = só relatório. true = repara o determinístico. */
  executar?: boolean
}

/**
 * Passos registrais concluídos de um processo, com o documento que cada um
 * carrega. É a lista de "fatos que deveriam ter produzido custo".
 */
async function passosRegistraisConcluidos(processoId: number) {
  const passos = await prisma.phaseWorkflowStepInstance.findMany({
    where: { processoId, status: "CONCLUIDO", documentoId: { not: null } },
    select: { id: true, stepKey: true, faseMacroKey: true, documentoId: true, ciclo: true },
    orderBy: { id: "asc" },
  })
  return passos.filter((p) => resolveWorkflowStepEditor({ stepKey: p.stepKey, phaseKey: p.faseMacroKey }).kind === "registral")
}

export async function reconciliarDocumentalFinanceiro(opts: Opcoes = {}): Promise<RelatorioReconciliacao> {
  const achados: AchadoReconciliacao[] = []
  let reparados = 0
  let documentosLocalizados = 0

  const processos = await prisma.processo.findMany({
    where: opts.processoId ? { id: opts.processoId } : {},
    select: { id: true, tipoProcessoMotorId: true },
  })

  for (const proc of processos) {
    // ── 1. custos existentes do processo, por célula (documento × serviço) ──
    const obrs = await prisma.obrigacaoEconomica.findMany({
      where: { processoId: proc.id, natureza: "CUSTO", status: { not: "CANCELADO" }, arquivadaEm: null },
      select: {
        id: true, documentoId: true, personId: true, tipoServicoId: true,
        moedaContratual: true, origemLancamento: true, pricingRuleId: true,
      },
    })
    const porCelula = new Map<string, number[]>()
    for (const o of obrs) {
      if (o.documentoId != null && o.tipoServicoId != null) {
        const k = `${o.documentoId}-${o.tipoServicoId}`
        porCelula.set(k, [...(porCelula.get(k) ?? []), o.id])
      }
      if (o.origemLancamento == null) {
        achados.push({
          tipo: "ORIGEM_NAO_CLASSIFICADA", processoId: proc.id, personId: o.personId, documentoId: o.documentoId,
          tipoServicoId: o.tipoServicoId, obrigacaoId: o.id, stepInstanceId: null,
          detalhe: "lançamento anterior à declaração de origem — classificar exige decisão, não inferência",
          reparavel: false,
        })
      }
      if (o.documentoId != null && o.tipoServicoId == null) {
        achados.push({
          tipo: "CUSTO_SEM_SERVICO", processoId: proc.id, personId: o.personId, documentoId: o.documentoId,
          tipoServicoId: null, obrigacaoId: o.id, stepInstanceId: null,
          detalhe: "custo vinculado a documento sem serviço — não tem coluna na planilha",
          reparavel: false,
        })
      }
      if (o.origemLancamento != null && o.origemLancamento !== "MANUAL" && o.documentoId == null) {
        achados.push({
          tipo: "CUSTO_SEM_DOCUMENTO", processoId: proc.id, personId: o.personId, documentoId: null,
          tipoServicoId: o.tipoServicoId, obrigacaoId: o.id, stepInstanceId: null,
          detalhe: "custo declarado automático sem vínculo documental",
          reparavel: false,
        })
      }
      if (o.origemLancamento != null && o.origemLancamento !== "MANUAL" && o.pricingRuleId == null) {
        achados.push({
          tipo: "CUSTO_SEM_TABELA", processoId: proc.id, personId: o.personId, documentoId: o.documentoId,
          tipoServicoId: o.tipoServicoId, obrigacaoId: o.id, stepInstanceId: null,
          detalhe: "custo automático sem regra de preço congelada",
          reparavel: false,
        })
      }
    }
    for (const [chave, ids] of porCelula) {
      if (ids.length > 1) {
        const [documentoId, tipoServicoId] = chave.split("-").map(Number)
        achados.push({
          tipo: "CUSTO_DUPLICADO", processoId: proc.id, personId: null, documentoId, tipoServicoId,
          obrigacaoId: ids[0], stepInstanceId: null,
          detalhe: `${ids.length} lançamentos ativos na mesma célula (${ids.join(", ")}) — qual sobrevive é decisão`,
          reparavel: false,
        })
      }
    }

    // ── 2. o que DEVERIA existir: cada documento localizado ─────────────────
    const passos = await passosRegistraisConcluidos(proc.id)
    for (const passo of passos) {
      const documentoId = passo.documentoId as number
      if (!(await documentoEstaLocalizado(documentoId))) continue
      documentosLocalizados++

      if (!proc.tipoProcessoMotorId) {
        achados.push({
          tipo: "SEM_REGRA_NA_MATRIZ", processoId: proc.id, personId: null, documentoId,
          tipoServicoId: null, obrigacaoId: null, stepInstanceId: passo.id,
          detalhe: "processo sem tipo de processo do motor — nenhuma regra pode ser resolvida",
          reparavel: false,
        })
        continue
      }

      // O motor é IDEMPOTENTE: em modo relatório rodamos igual e olhamos o que ele
      // diz que criaria. Não há "simulação" paralela — usar um caminho diferente do
      // real para prever o real seria criar a segunda verdade que queremos evitar.
      if (!opts.executar) {
        const previsto = await previsaoSemEscrita(proc.id, proc.tipoProcessoMotorId, passo.faseMacroKey, passo.ciclo, documentoId)
        achados.push(...previsto.map((d) => ({ ...d, stepInstanceId: passo.id })))
        continue
      }

      const r = await gerarEconomicoDaMatriz(
        proc.id, proc.tipoProcessoMotorId, passo.faseMacroKey, passo.ciclo,
        { documentoId, origemLancamento: ORIGEM_BACKFILL, eventoOrigemTipo: EVENTO_ORIGEM_PASSO, eventoOrigemId: passo.id },
      )
      reparados += r.criados.filter((i) => i.custoId != null).length
      for (const p of r.pulados) {
        if (p.motivo.startsWith("já criado")) continue // idempotência: nada a relatar
        achados.push({
          tipo: classificarPulo(p.motivo), processoId: proc.id, personId: null, documentoId,
          tipoServicoId: null, obrigacaoId: null, stepInstanceId: passo.id,
          detalhe: `${p.motivo}${p.detalhe ? ` — ${p.detalhe}` : ""}`, reparavel: false,
        })
      }
    }
  }

  return {
    processos: processos.length,
    documentosLocalizados,
    achados,
    reparados,
    ambiguos: achados.filter((a) => !a.reparavel).length,
  }
}

/**
 * Traduz o "pulado" do motor no achado correspondente. Os motivos são emitidos
 * por `resolverElegibilidadeDocumental` e por `gerarEconomicoDaMatriz` — este
 * mapa é a única tradução, e o `default` é `NAO_ELEGIVEL` (nunca
 * `CUSTO_AUSENTE`): um item que o motor não geraria não pode ser relatado como
 * lançamento faltando.
 */
function classificarPulo(motivo: string): AchadoReconciliacao["tipo"] {
  if (motivo.includes("sem regra na Matriz")) return "SEM_REGRA_NA_MATRIZ"
  if (motivo.includes("tipo documental inexistente")) return "REGRA_SEM_TIPO_DOCUMENTAL"
  if (motivo.includes("sem regra econômica")) return "SEM_REGRA_ECONOMICA"
  if (motivo.includes("condição da regra")) return "CONDICAO_NAO_SATISFEITA"
  if (motivo.includes("pendência financeira") || motivo.includes("Configuração Financeira")) return "SEM_PRECO_VIGENTE"
  if (motivo.includes("câmbio") || motivo.includes("cotação")) return "CUSTO_SEM_CAMBIO"
  return "NAO_ELEGIVEL"
}

/**
 * Diagnóstico SEM ESCRITA, pelo MESMO critério do motor.
 *
 * A versão anterior tinha critério próprio ("tem Matriz? tem componente? então é
 * reparável") e por isso conseguia prometer um reparo que o `--execute` não
 * entregava — bastava o documento não ser elegível para o `--execute` criar zero
 * em silêncio. Agora quem responde "o que deveria existir" é
 * `resolverElegibilidadeDocumental`, a mesma resolução que o motor consome.
 *
 * `reparavel: true` só sai quando as TRÊS condições que o motor exige valem:
 *   1. o item é elegível (regra + tipo documental + condição + componente);
 *   2. não há lançamento com aquela chave idempotente;
 *   3. o preço resolve na Tabela vigente, sem bloqueio nem conflito.
 * Faltando a 3ª, o achado vira SEM_PRECO_VIGENTE — que é o que o `--execute`
 * realmente faria (registrar pendência, não lançar).
 */
async function previsaoSemEscrita(
  processoId: number, tipoProcessoId: number, phaseKey: string, phaseCycle: number, documentoId: number,
): Promise<Omit<AchadoReconciliacao, "stepInstanceId">[]> {
  const achados: Omit<AchadoReconciliacao, "stepInstanceId">[] = []

  const eleg = await resolverElegibilidadeDocumental(processoId, tipoProcessoId, phaseKey, phaseCycle, { documentoId })

  // Motivos de não-elegibilidade viram achados nomeados — o relatório explica
  // POR QUE não há custo, em vez de deixar o silêncio parecer "tudo certo".
  for (const p of eleg.pulados) {
    achados.push({
      tipo: classificarPulo(p.motivo), processoId, personId: null, documentoId,
      tipoServicoId: null, obrigacaoId: null,
      detalhe: `${p.motivo}${p.detalhe ? ` — ${p.detalhe}` : ""}`, reparavel: false,
    })
  }

  for (const el of eleg.itens) {
    if (!el.criaCusto) continue
    const chave = `${el.chaveBase}::custo`

    // 2. já existe? (a chave é @unique na obrigação — a consulta é exata)
    const existente = await prisma.obrigacaoEconomica.findUnique({
      where: { chaveIdempotencia: chave }, select: { id: true },
    })
    if (existente) continue

    // 3. o preço resolve? (leitura pura — o mesmo resolvedor que o motor usa)
    if (!el.custoConfigId) {
      achados.push({
        tipo: "SEM_REGRA_ECONOMICA", processoId, personId: el.pessoaId, documentoId: el.documentoId,
        tipoServicoId: null, obrigacaoId: null,
        detalhe: `componente "${el.componente}" gera custo mas não tem Configuração Financeira de custo`,
        reparavel: false,
      })
      continue
    }
    const preco = await resolverPrecoPorConfigDB(el.custoConfigId, {
      processoId, tipoProcessoId: String(tipoProcessoId), natureza: NaturezaPreco.CUSTO,
    })
    if (!preco.ok || preco.conflito) {
      achados.push({
        tipo: "SEM_PRECO_VIGENTE", processoId, personId: el.pessoaId, documentoId: el.documentoId,
        tipoServicoId: null, obrigacaoId: null,
        detalhe: `"${el.componente}": ${preco.ok ? preco.conflito?.nota : `${preco.motivo} — ${preco.razao}`}`,
        reparavel: false,
      })
      continue
    }

    achados.push({
      tipo: "CUSTO_AUSENTE", processoId, personId: el.pessoaId, documentoId: el.documentoId,
      tipoServicoId: null, obrigacaoId: null,
      detalhe: `"${el.componente}" para ${el.pessoaNome} — elegível, com preço vigente e sem lançamento`,
      reparavel: true,
    })
  }

  return achados
}
