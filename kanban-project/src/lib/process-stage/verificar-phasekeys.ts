// src/lib/process-stage/verificar-phasekeys.ts
//
// VERIFICADOR OFICIAL de phaseKey — cadastro × catálogo canônico.
//
// O motor resolve a fase pela chave EXATA: sem alias, sem tradução textual, sem
// fallback. Isso é o comportamento certo, e é por isso que uma chave errada no
// cadastro trava o processo em vez de o desviar em silêncio. O que faltava era um
// lugar que ACHE a chave errada antes de o processo chegar nela.
//
// A fonte de verdade é o catálogo (`fases-catalog`), nunca uma lista repetida aqui.
//
// NÃO corrige nada. Diagnostica, classifica a severidade e diz — quando a
// equivalência é determinística — qual seria a chave canônica. Corrigir é ato
// separado, transacional e auditado (`scripts/corrigir-phasekeys-macro.ts`).

import { FASES, phaseKeyToFaseCode } from "./fases-catalog"

/**
 * Equivalências CONFIRMADAS entre chave legada e canônica. Fechado: uma chave que
 * não está aqui é AMBÍGUA, e ambíguo não se corrige automaticamente.
 *
 * Precisa bater com `MAPEAMENTO_CANONICO` do script de correção — o guard checa isso.
 */
export const EQUIVALENCIA_LEGADA: Record<string, string> = {
  traducao: "traducao_juramentada",
  retificacao: "retificacao_registros",
}

export type SeveridadePhaseKey = "CRITICA" | "ALTA" | "MEDIA"

export interface AchadoPhaseKey {
  tipo:
    | "PHASEKEY_FORA_DO_CATALOGO"
    | "PHASEKEY_DUPLICADA_NO_MACRO"
    | "FASE_OBRIGATORIA_SEM_WORKFLOW"
    /**
     * A ORIGEM da recorrência: `CatalogoFase` é o cadastro de onde um MacroWorkflow
     * novo copia as fases (`seedDefaults`). Chave legada aqui não trava nada hoje —
     * ela ressemeia o defeito no próximo macro criado.
     */
    | "CATALOGO_FASE_COM_CHAVE_LEGADA"
    /** Modo interno da fase apontando para uma fase que não existe no catálogo. */
    | "MODO_DE_FASE_COM_CHAVE_LEGADA"
  severidade: SeveridadePhaseKey
  macroWorkflowId: number
  macroNome: string | null
  tipoProcessoCode: string | null
  faseMacroId: number | null
  phaseKey: string
  ordem: number | null
  /** Chave canônica quando a equivalência é determinística; `null` = ambíguo. */
  canonicaSugerida: string | null
  /** Processos vinculados ao tipo — o tamanho do estrago. */
  processosAfetados: number
  detalhe: string
}

/** Uma FaseMacro, reduzida ao que a verificação precisa. */
export interface FaseMacroParaVerificar {
  id: number
  macroWorkflowId: number
  macroNome: string | null
  tipoProcessoId: number | null
  tipoProcessoCode: string | null
  phaseKey: string
  ordem: number
  required: boolean
}

/** Uma linha do CatalogoFase — o molde de onde macros novos nascem. */
export interface CatalogoFaseParaVerificar {
  id: number
  phaseKey: string
  label: string
  ativo: boolean
}

export interface ContextoVerificacao {
  fases: FaseMacroParaVerificar[]
  /** phaseKeys que TÊM Workflow Interno publicado e ativo. */
  phaseKeysComWorkflow: Set<string>
  /** Quantos processos existem por tipo de processo. */
  processosPorTipo: Map<number, number>
  /** Cadastro de fases padrão. Omitido ⇒ não verifica a origem. */
  catalogoFase?: CatalogoFaseParaVerificar[]
  /** Modos internos por fase (`PhaseInternalMode`). Omitido ⇒ não verifica. */
  modosDeFase?: Array<{ id: number; phaseKey: string; key: string; modeUid: string }>
}

/** NÚCLEO PURO — sem prisma. A mesma função serve ao guard e ao runtime. */
export function verificarPhaseKeys(ctx: ContextoVerificacao): AchadoPhaseKey[] {
  const achados: AchadoPhaseKey[] = []
  const contar = (tipoId: number | null) => (tipoId != null ? ctx.processosPorTipo.get(tipoId) ?? 0 : 0)

  for (const f of ctx.fases) {
    if (phaseKeyToFaseCode(f.phaseKey) != null) continue
    const sugerida = EQUIVALENCIA_LEGADA[f.phaseKey] ?? null
    achados.push({
      tipo: "PHASEKEY_FORA_DO_CATALOGO",
      // Uma chave inválida numa fase OBRIGATÓRIA trava o processo no caminho feliz;
      // numa condicional, só quando a condição se aplica. A severidade diz isso.
      severidade: f.required ? "CRITICA" : "ALTA",
      macroWorkflowId: f.macroWorkflowId,
      macroNome: f.macroNome,
      tipoProcessoCode: f.tipoProcessoCode,
      faseMacroId: f.id,
      phaseKey: f.phaseKey,
      ordem: f.ordem,
      canonicaSugerida: sugerida,
      processosAfetados: contar(f.tipoProcessoId),
      detalhe: sugerida
        ? `"${f.phaseKey}" não está no catálogo; a equivalência canônica confirmada é "${sugerida}".`
        : `"${f.phaseKey}" não está no catálogo e NÃO tem equivalência conhecida — decisão humana.`,
    })
  }

  // Duplicidade de chave dentro do mesmo macro: o motor escolheria uma delas.
  const porMacro = new Map<string, FaseMacroParaVerificar[]>()
  for (const f of ctx.fases) {
    const k = `${f.macroWorkflowId}|${f.phaseKey}`
    porMacro.set(k, [...(porMacro.get(k) ?? []), f])
  }
  for (const [, lista] of porMacro) {
    if (lista.length < 2) continue
    const f = lista[0]
    achados.push({
      tipo: "PHASEKEY_DUPLICADA_NO_MACRO",
      severidade: "CRITICA",
      macroWorkflowId: f.macroWorkflowId,
      macroNome: f.macroNome,
      tipoProcessoCode: f.tipoProcessoCode,
      faseMacroId: null,
      phaseKey: f.phaseKey,
      ordem: null,
      canonicaSugerida: null,
      processosAfetados: contar(f.tipoProcessoId),
      detalhe: `A fase "${f.phaseKey}" aparece ${lista.length} vezes no macro (ids ${lista.map((x) => x.id).join(", ")}).`,
    })
  }

  // Fase OBRIGATÓRIA e canônica, mas sem workflow publicado: o processo chega nela
  // e não materializa nada. O motor recusa — mas o operador só descobre no impacto.
  for (const f of ctx.fases) {
    if (!f.required) continue
    if (phaseKeyToFaseCode(f.phaseKey) == null) continue
    if (ctx.phaseKeysComWorkflow.has(f.phaseKey)) continue
    achados.push({
      tipo: "FASE_OBRIGATORIA_SEM_WORKFLOW",
      severidade: "ALTA",
      macroWorkflowId: f.macroWorkflowId,
      macroNome: f.macroNome,
      tipoProcessoCode: f.tipoProcessoCode,
      faseMacroId: f.id,
      phaseKey: f.phaseKey,
      ordem: f.ordem,
      canonicaSugerida: null,
      processosAfetados: contar(f.tipoProcessoId),
      detalhe: `A fase obrigatória "${f.phaseKey}" não tem Workflow Interno publicado aplicável.`,
    })
  }

  // ORIGEM — o cadastro que serve de molde. Não trava processo nenhum HOJE; é o que
  // faz o defeito voltar amanhã, no próximo macro criado a partir dele.
  for (const c of ctx.catalogoFase ?? []) {
    if (phaseKeyToFaseCode(c.phaseKey) != null) continue
    const sugerida = EQUIVALENCIA_LEGADA[c.phaseKey] ?? null
    achados.push({
      tipo: "CATALOGO_FASE_COM_CHAVE_LEGADA",
      severidade: "MEDIA",
      macroWorkflowId: -1,
      macroNome: "(CatalogoFase — molde de macros novos)",
      tipoProcessoCode: null,
      faseMacroId: c.id,
      phaseKey: c.phaseKey,
      ordem: null,
      canonicaSugerida: sugerida,
      processosAfetados: 0,
      detalhe: sugerida
        ? `CatalogoFase #${c.id} "${c.phaseKey}" não está no catálogo canônico; todo MacroWorkflow criado com seedDefaults nasce com esta chave. Equivalência confirmada: "${sugerida}".`
        : `CatalogoFase #${c.id} "${c.phaseKey}" não está no catálogo canônico e não tem equivalência conhecida — decisão humana.`,
    })
  }

  // Modos internos da fase: keyed por phaseKey. Com a chave desalinhada, a fase existe
  // e os modos dela ficam órfãos — a tela não acha nenhum, sem dizer por quê.
  for (const m of ctx.modosDeFase ?? []) {
    if (phaseKeyToFaseCode(m.phaseKey) != null) continue
    const sugerida = EQUIVALENCIA_LEGADA[m.phaseKey] ?? null
    achados.push({
      tipo: "MODO_DE_FASE_COM_CHAVE_LEGADA",
      severidade: "ALTA",
      macroWorkflowId: -2,
      macroNome: "(PhaseInternalMode — modos da fase)",
      tipoProcessoCode: null,
      faseMacroId: m.id,
      phaseKey: m.phaseKey,
      ordem: null,
      canonicaSugerida: sugerida,
      processosAfetados: 0,
      detalhe: `PhaseInternalMode #${m.id} ("${m.modeUid}") aponta para a fase "${m.phaseKey}", fora do catálogo — os modos ficam órfãos da fase que os usa.`,
    })
  }

  const peso: Record<SeveridadePhaseKey, number> = { CRITICA: 0, ALTA: 1, MEDIA: 2 }
  return achados.sort((a, b) => peso[a.severidade] - peso[b.severidade] || b.processosAfetados - a.processosAfetados)
}

/** Chaves canônicas, para quem precisa listar o vocabulário oficial. */
export function phaseKeysCanonicas(): string[] {
  return Object.values(FASES).map((f) => f.phaseKey)
}
