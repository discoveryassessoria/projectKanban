// lib/operacional/torre-abas.ts
// ============================================================================
// AS ABAS DA TORRE — CONSOLIDAÇÃO (06/10/2026). PURO: a tela (`Torre.tsx`) e o teste leem a MESMA lista.
//
// LEI DA TORRE: L1 cada informação em UM lugar · L2 cada aba responde UMA pergunta (escrita no cabeçalho dela) · L3 todo número é a própria
// lista · L4 só a aba Tarefas atribui · L5 estado de fase tem uma fonte só · L6 bloco/aba novo diz que pergunta responde e o que substitui.
//
// CINCO abas, cada uma com a SUA pergunta:
//   Hoje      — "O que está pegando hoje?"       (funde Visão geral + Precisa de você; só alarmes, sem botão de ação)
//   Tarefas   — "Quem faz o quê?"                (todas as tarefas abertas; ÚNICO lugar que atribui)
//   Famílias  — "Como está cada família?"        (lista de processos + alternador lista↔matriz — o antigo Radar — + a página do processo)
//   Equipe    — "A equipe dá conta?"             (carga, aptidão, ausência, previsão; mudanças de carteira são PROPOSTA com prévia)
//   Terceiros — "O que estamos esperando de fora?" (órgãos, não tarefas)
// O Processo (detalhe) NÃO é aba: é a página `/torre/processo/[id]`. "Minha operação" saiu da Torre: é a tela de quem executa e mora em `/operacao`.
//
// CONTRATO DE URL — `?aba=` com ids ESTÁVEIS: hoje · tarefas · familias · equipe · terceiros. Os ids ANTIGOS continuam válidos e são traduzidos
// (`abaDaUrl`): visao/precisa → hoje · processos → familias · radar → familias com `?vista=matriz` · minha → /operacao (fora da Torre).
// `?aba=regras|integridade|auditoria` não é aba da Torre: redireciona para o Gerenciamento (`destinoDaAbaAntigaDaTorre`).
// ============================================================================

export type Aba = 'hoje' | 'tarefas' | 'familias' | 'equipe' | 'terceiros'

/** As abas, na ordem, com o rótulo oficial e a PERGUNTA que cada uma responde (escrita no cabeçalho da aba — L2). */
export const ABAS_DA_TORRE: Array<[Aba, string]> = [
  ['hoje', 'Hoje'], ['tarefas', 'Tarefas'], ['familias', 'Famílias'], ['equipe', 'Equipe'], ['terceiros', 'Terceiros'],
]

export const PERGUNTA_DA_ABA: Record<Aba, string> = {
  hoje: 'O que está pegando hoje?',
  tarefas: 'Quem faz o quê?',
  familias: 'Como está cada família?',
  equipe: 'A equipe dá conta?',
  terceiros: 'O que estamos esperando de fora?',
}

/** A aba em que a Torre abre quando a URL não pede outra. */
export const ABA_INICIAL: Aba = 'hoje'

/** Os ids de aba válidos em `?aba=`. */
export const IDS_DAS_ABAS: readonly Aba[] = ABAS_DA_TORRE.map(([id]) => id)

/** Ids ANTIGOS de aba (links do sino, avisos gravados, favoritos) → onde caem agora. `minha` sai da Torre (vai para /operacao). */
export const ABA_ANTIGA_PARA_NOVA: Record<string, { aba: Aba; vista?: 'matriz' } | { fora: string }> = {
  visao: { aba: 'hoje' }, precisa: { aba: 'hoje' }, radar: { aba: 'familias', vista: 'matriz' }, processos: { aba: 'familias' },
  minha: { fora: '/operacao' },
}
export const IDS_ANTIGOS_DAS_ABAS: readonly string[] = Object.keys(ABA_ANTIGA_PARA_NOVA)

export const ehAbaDaTorre = (v: string | null | undefined): v is Aba => !!v && (IDS_DAS_ABAS as readonly string[]).includes(v)

/** O `?aba=` (novo OU antigo) → a aba (valor desconhecido ou ausente = a inicial). */
export function abaDaUrl(v: string | null | undefined): Aba {
  if (ehAbaDaTorre(v)) return v
  const antiga = v ? ABA_ANTIGA_PARA_NOVA[v] : undefined
  return antiga && 'aba' in antiga ? antiga.aba : ABA_INICIAL
}

/** O `?aba=` antigo que SAIU da Torre (ex.: `minha`) → o endereço de fora para onde ele leva; senão `null`. */
export const destinoDeAbaQueSaiu = (v: string | null | undefined): string | null => {
  const antiga = v ? ABA_ANTIGA_PARA_NOVA[v] : undefined
  return antiga && 'fora' in antiga ? antiga.fora : null
}

/** Rótulo oficial da aba. */
export const rotuloDaAba = (aba: Aba): string => ABAS_DA_TORRE.find(([id]) => id === aba)![1]
