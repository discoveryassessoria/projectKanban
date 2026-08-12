// lib/gerenciamento/mestre-financeiro.ts
//
// APRESENTAÇÃO DO CADASTRO MESTRE EM CONFIGURAÇÕES FINANCEIRAS.
//
// A REGRA
// -------
// Configurações Financeiras é tela de PARAMETRIZAÇÃO. Ela identifica o cadastro
// mestre pelo NOME LEGÍVEL — em todos os pontos visuais: listagem, dropdown,
// valor selecionado, modal de criação, de edição e de exclusão.
//
// O código público (SRV-n) e a chave estrutural (APOSTILAMENTO_TRADUCAO) são do
// CADASTRO DE ORIGEM, o Catálogo de Serviços. Lá eles aparecem, em colunas
// próprias. Aqui, não.
//
// DADO PESQUISÁVEL ≠ DADO EXIBIDO
// -------------------------------
// A busca continua aceitando nome, SRV-n, chave e origem — quem procura por
// "SRV-8" encontra. O que muda é só o que a tela ESCREVE. Por isso os dois lados
// vivem em funções separadas aqui: `nomeExibidoDoMestre` (o que se vê) e
// `termosBuscaveisDoMestre` (o que casa com a busca).
//
// POR QUE UMA FUNÇÃO SÓ
// ---------------------
// O vazamento não era um ponto: eram quatro (listagem, opção do dropdown, valor
// selecionado, subtítulo "Chave:"), cada um montando a própria concatenação.
// Corrigir ponto a ponto deixaria o quinto nascer errado. Aqui o componente
// recebe os campos SEPARADOS e renderiza `displayName` — não existe string
// pré-concatenada para vazar.

/**
 * O mestre como a camada visual o recebe: campos separados, nunca concatenados.
 * `sourceId` é o vínculo (value dos selects); `displayName` é a única coisa que
 * a tela de Configurações Financeiras escreve.
 */
export interface MestreFinanceiro {
  sourceId: number
  /** documento | servico | honorario | processo | item */
  sourceType: string
  /** código público do cadastro de origem (ex.: "SRV-8"); null quando não há */
  sourceCode: string | null
  /** chave estrutural interna (ex.: "APOSTILAMENTO_TRADUCAO") */
  masterKey: string | null
  /** nome legível — o ÚNICO campo exibido nesta tela */
  displayName: string
}

/**
 * Nome de exibição do mestre em Configurações Financeiras.
 *
 * Equivalente canônico de `getFinancialConfigurationMasterDisplayName`. Devolve
 * SÓ o nome legível: nunca código, chave, slug, id, nem concatenação.
 *
 * Não usa substring nem replace para "tirar" o SRV-n de um rótulo pronto — ele
 * nunca chega aqui montado. Recebe o campo certo e devolve o campo certo.
 */
export function nomeExibidoDoMestre(m: Pick<MestreFinanceiro, 'displayName'> | null | undefined): string {
  return (m?.displayName ?? '').trim()
}

/**
 * Termos que a BUSCA considera — inclui o que a tela não exibe.
 * Nome, código público, chave estrutural e origem, tudo em minúsculas.
 */
export function termosBuscaveisDoMestre(m: Partial<MestreFinanceiro> | null | undefined): string {
  return [m?.displayName, m?.sourceCode, m?.masterKey, m?.sourceType]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** O mestre casa com o termo buscado? Compara contra os termos, não contra o exibido. */
export function combinaComBusca(m: Partial<MestreFinanceiro> | null | undefined, termo: string): boolean {
  const q = termo.trim().toLowerCase()
  if (!q) return true
  return termosBuscaveisDoMestre(m).includes(q)
}

/** Normaliza o mestre que a API devolve dentro de cada configuração. */
export function mestreDaConfiguracao(
  p: {
    id?: number
    nome?: string
    mestre?: { origem?: string; codigo?: string | null; nome?: string; publicCode?: string | null } | null
  },
): MestreFinanceiro {
  return {
    sourceId: p.id ?? 0,
    sourceType: p.mestre?.origem ?? '',
    sourceCode: p.mestre?.publicCode ?? null,
    masterKey: p.mestre?.codigo ?? null,
    // Sem mestre resolvido, o nome próprio da configuração é o melhor nome real
    // que existe — e continua sendo NOME, não identificador.
    displayName: p.mestre?.nome || p.nome || '',
  }
}

/** Normaliza uma opção do seletor de mestre (lista de cadastros oficiais). */
export function mestreSelecionavel(
  sourceType: string,
  b: { id: number; name: string; code?: string | null; publicCode?: string | null },
): MestreFinanceiro {
  return {
    sourceId: b.id,
    sourceType,
    sourceCode: b.publicCode ?? null,
    masterKey: b.code ?? null,
    displayName: b.name,
  }
}
