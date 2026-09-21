// src/lib/motor/validar-composicao-macro.ts
// ============================================================================
// VALIDAÇÕES DE PUBLICAÇÃO do Workflow Macro — mandato "Catálogo de Fases"
// (20/09/2026). Bloqueios adicionais aos já existentes na rota (chave
// duplicada, sem escopo, chave legada, fase inativa/rascunho — ver
// `avaliarAptidaoDaFase`). Puro, testável sem banco: recebe a composição já
// carregada e devolve os problemas, nunca lança.
//
// ESCOPO HONESTO: `FaseMacro` não tem grafo de dependência (`dependeDe`) —
// `entryRule` é sempre derivado da posição pela própria rota
// (`process_created` no primeiro, `previous_phase_completed` nos demais).
// Não existe HOJE mecanismo para criar um ciclo de verdade nesta estrutura.
// "Dependência circular" e "fase obrigatória inalcançável" são cobertas aqui
// pelo único jeito real de uma composição travar a si mesma no modelo atual:
// terminar numa fase que pode nunca se aplicar (condicional) — o processo
// entraria na última posição sem nunca ter uma fase seguinte que force o
// desfecho. Se `FaseMacro` um dia ganhar dependência explícita entre fases,
// a detecção de ciclo de verdade entra AQUI, não em um arquivo novo.
// ============================================================================

export interface FaseComposicaoInput {
  phaseKey: string
  required: boolean
  conditional: boolean
}

export interface ProblemaComposicao {
  codigo: string
  mensagem: string
  phaseKey?: string
}

const REGEX_PHASEKEY = /^[a-z][a-z0-9_]*$/

/** Formato do código — minúsculo, snake_case, sem espaço/acento/maiúscula. */
export function validarFormatoPhaseKey(phaseKey: string): ProblemaComposicao | null {
  if (!REGEX_PHASEKEY.test(phaseKey)) {
    return {
      codigo: "CODIGO_INVALIDO_NAO_NORMALIZADO",
      phaseKey,
      mensagem: `"${phaseKey}" não é um código normalizado — use apenas letras minúsculas, números e "_", começando por letra. Evita a mesma inconsistência de caixa que gerou "TESTEVIS_fase".`,
    }
  }
  return null
}

/** `required` e `conditional` simultaneamente é uma contradição: obrigatória incondicional não pode também depender de condição. */
export function validarCondicaoValida(f: FaseComposicaoInput): ProblemaComposicao | null {
  if (f.required && f.conditional) {
    return {
      codigo: "CONDICAO_INVALIDA",
      phaseKey: f.phaseKey,
      mensagem: `A fase "${f.phaseKey}" está marcada como obrigatória E condicional ao mesmo tempo — contraditório. Obrigatória incondicional não depende de decisão nenhuma; se depende, não é incondicional.`,
    }
  }
  return null
}

/**
 * A ÚLTIMA fase da composição precisa ser obrigatória e não-condicional — sem
 * isso o fluxo não tem desfecho garantido (a composição terminaria numa fase
 * que pode nunca se aplicar, e o processo ficaria sem próxima fase possível).
 * É a leitura real, dado o modelo atual, de "fase obrigatória inalcançável"
 * e "dependência circular": um fluxo cujo fim depende de uma condição que
 * pode nunca se resolver.
 */
export function validarFimGarantido(fases: FaseComposicaoInput[]): ProblemaComposicao | null {
  const ultima = fases[fases.length - 1]
  if (!ultima) return null
  if (!ultima.required || ultima.conditional) {
    return {
      codigo: "FASE_FINAL_SEM_DESFECHO_GARANTIDO",
      phaseKey: ultima.phaseKey,
      mensagem: `A última fase da composição ("${ultima.phaseKey}") precisa ser obrigatória e não-condicional. Terminando numa fase condicional/opcional, o fluxo não tem desfecho garantido — o processo pode nunca alcançar uma fase final.`,
    }
  }
  return null
}

export interface TipoProcessoValidavel {
  id: number
  ativo: boolean
  arquivado: boolean
}

/** O tipo de processo precisa existir, estar ativo e não arquivado. */
export function validarTipoProcesso(tipo: TipoProcessoValidavel | null): ProblemaComposicao | null {
  if (!tipo) {
    return { codigo: "TIPO_PROCESSO_AUSENTE", mensagem: "Tipo de processo não encontrado — não é possível publicar um Workflow Macro sem ele." }
  }
  if (tipo.arquivado) {
    return { codigo: "TIPO_PROCESSO_INCOMPATIVEL", mensagem: "Este tipo de processo está arquivado — não pode receber uma nova publicação de Workflow Macro." }
  }
  if (!tipo.ativo) {
    return { codigo: "TIPO_PROCESSO_INCOMPATIVEL", mensagem: "Este tipo de processo está inativo — não pode receber uma nova publicação de Workflow Macro." }
  }
  return null
}

/**
 * Roda todas as validações de composição e devolve a lista completa de problemas
 * (nunca lança, nunca para na primeira).
 *
 * `chavesJaCadastradas` — fases que JÁ EXISTEM no Catálogo, informadas por quem
 * chama (esta função é pura, não lê banco). O formato normalizado
 * (`validarFormatoPhaseKey`) só se aplica a chave NOVA: barrar toda chave já
 * cadastrada tornaria `TESTEVIS_fase` — citada acima como o próprio exemplo
 * histórico do problema — permanentemente impossível de compor em qualquer
 * fluxo, mesmo já publicada, com revisões e processos reais apontando pra ela.
 * O validador existe para not deixar NASCER outra inconsistência dessas, não
 * para apagar retroativamente a que já existe (achado real, mandato "Módulo de
 * Fases", 20/09/2026).
 */
export function validarComposicaoMacro(
  fases: FaseComposicaoInput[],
  tipo: TipoProcessoValidavel | null,
  chavesJaCadastradas: ReadonlySet<string> = new Set(),
): ProblemaComposicao[] {
  const problemas: ProblemaComposicao[] = []
  const pTipo = validarTipoProcesso(tipo)
  if (pTipo) problemas.push(pTipo)
  for (const f of fases) {
    if (!chavesJaCadastradas.has(f.phaseKey)) {
      const pFormato = validarFormatoPhaseKey(f.phaseKey)
      if (pFormato) problemas.push(pFormato)
    }
    const pCondicao = validarCondicaoValida(f)
    if (pCondicao) problemas.push(pCondicao)
  }
  const pFim = validarFimGarantido(fases)
  if (pFim) problemas.push(pFim)
  return problemas
}
