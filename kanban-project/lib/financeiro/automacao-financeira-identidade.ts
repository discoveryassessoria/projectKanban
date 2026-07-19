// lib/financeiro/automacao-financeira-identidade.ts
// IDENTIDADE ESTRUTURADA da automação financeira. Nome/Descrição NÃO são digitados:
// título e descrição são DERIVADOS da regra (Aplicação + Configuração Financeira +
// gatilho + fase). Fonte única usada por UI, API e executor — nunca texto livre.

const APLIC_LABEL: Record<string, string> = { RECEITA: 'Receita', CUSTO: 'Custo', AMBOS: 'Custo e receita' }

const FASE_LABEL: Record<string, string> = {
  genealogia: 'Genealogia', emissao_documental: 'Emissão Documental', analise_documental: 'Análise Documental',
  retificacao: 'Retificação', emissao_documental_retificada: 'Emissão Documental Retificada', traducao: 'Tradução',
  apostilamento: 'Apostilamento', aguardando_protocolo: 'Aguardando Protocolo', protocolado: 'Protocolado', finalizado: 'Finalizado',
}

const GATILHO_INICIO: Record<string, string> = {
  phase_entered: 'Ao iniciar a fase', entered: 'Ao iniciar a fase',
  phase_completed: 'Ao concluir a fase', completed: 'Ao concluir a fase',
}

export function faseLabel(phaseKey: string | null | undefined): string {
  return (phaseKey && FASE_LABEL[phaseKey]) || phaseKey || ''
}

/** Título legível: "Receita • Honorários da Genealogia". Nunca editável. */
export function tituloAutomacaoFinanceira(aplicacao: string | null | undefined, mestreNome: string): string {
  return `${APLIC_LABEL[aplicacao ?? ''] ?? 'Financeiro'} • ${mestreNome}`
}

/** Descrição derivada: "Ao iniciar a fase Genealogia, cria automaticamente uma Receita
 *  utilizando a Configuração Financeira Honorários da Genealogia." */
export function descricaoAutomacaoFinanceira(p: {
  trigger?: string | null; phaseKey?: string | null; aplicacao?: string | null; mestreNome: string
}): string {
  const gatilho = GATILHO_INICIO[p.trigger ?? ''] ?? 'No gatilho da fase'
  const fase = faseLabel(p.phaseKey)
  const ap = p.aplicacao === 'AMBOS' ? 'Custo e Receita' : p.aplicacao === 'CUSTO' ? 'um Custo' : 'uma Receita'
  return `${gatilho}${fase ? ' ' + fase : ''}, cria automaticamente ${ap} utilizando a Configuração Financeira ${p.mestreNome}.`
}

/** Descrição do LANÇAMENTO — derivada da Configuração Financeira (o nome do mestre),
 *  NUNCA do Nome da automação. */
export function descricaoLancamentoDaConfig(mestreNome: string): string {
  return mestreNome
}
