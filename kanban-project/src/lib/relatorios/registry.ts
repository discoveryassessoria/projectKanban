// src/lib/relatorios/registry.ts
//
// CATÁLOGO CANÔNICO DE RELATÓRIOS.
//
// ─── O QUE ESTE ARQUIVO É, E O QUE ELE NÃO É ────────────────────────────────
// Ele declara QUAIS relatórios o Discovery oferece, em que FAMÍLIA cada um mora
// e que permissão exige. Ele NÃO declara nacionalidade, órgão, documento,
// status, serviço ou qualquer conceito do negócio: essas listas vêm dos
// Cadastros Mestres, em tempo de execução.
//
// A NACIONALIDADE, em particular, NUNCA aparece aqui. Ela vem de `CatalogoPais`
// e é CONTEXTO, não fork: existe UM relatório de Protocolos, e a nacionalidade
// escolhida entra nele como filtro. Uma rota nova aparece na navegação sem
// nenhuma linha de código — foi para isso que a lista saiu daqui.
//
// FAMÍLIA é a propriedade canônica: "Certidões atrasadas" pertence a CERTIDÕES
// com dimensão de prazo, e não a SLA. Um relatório tem UM dono; visões cruzadas
// podem virar atalho, nunca segunda definição.

/** As famílias na ordem em que aparecem. Domínio, não tela. */
export const FAMILIAS = [
  "Processos",
  "Requerentes",
  "Completude",
  "Certidões",
  "Documentos",
  "Protocolos",
  "Exigências",
  "Operação",
  "Prazos e SLA",
  "Órgãos",
  "Financeiro",
  "Qualidade",
  "Auditoria",
  "Exceções",
] as const
export type Familia = (typeof FAMILIAS)[number]

export interface RelatorioSpec {
  /** Deep-link: /relatorios?r=<key>. Estável — nunca renomear. */
  key: string
  titulo: string
  /** A pergunta que ele responde, em uma linha. */
  descricao: string
  familia: Familia
  /** Granularidade declarada: o que é UMA linha. Protege contra JOIN inflado. */
  granularidade: string
  /** Permissão mínima. O servidor confere de novo — esconder não é autorizar. */
  permissao: string
  /**
   * O relatório usa a nacionalidade como filtro? Quase todos usam; os que não
   * usam (visões administrativas) ficam fora da navegação por país.
   */
  aceitaNacionalidade: boolean
}

export const RELATORIOS: RelatorioSpec[] = [
  {
    key: "protocolos",
    titulo: "Protocolos",
    descricao:
      "O que foi protocolado, em qual consulado ou tribunal, de qual família e quando — com o que está em exigência.",
    familia: "Protocolos",
    granularidade: "1 linha = 1 protocolo",
    permissao: "processos.ver_paginas",
    aceitaNacionalidade: true,
  },
  {
    key: "pendencias-por-pessoa",
    titulo: "Pendências por pessoa",
    descricao:
      "O que falta para cada pessoa — documentos e dados cadastrais — com o percentual de completude e os bloqueadores.",
    familia: "Completude",
    granularidade: "1 linha = 1 pessoa",
    permissao: "processos.ver_paginas",
    aceitaNacionalidade: true,
  },
  {
    key: "pendencias-por-requisito",
    titulo: "Pendências por requisito",
    descricao:
      "O inverso: quem está sem RG, sem endereço, sem e-mail. Mesma avaliação, agrupada pelo requisito.",
    familia: "Completude",
    granularidade: "1 linha = 1 requisito",
    permissao: "processos.ver_paginas",
    aceitaNacionalidade: true,
  },
]

export const relatorioPorChave = (k: string | null) => RELATORIOS.find((r) => r.key === k) ?? null

/** Famílias que têm ao menos um relatório visível para quem está olhando. */
export function familiasVisiveis(pode: (p: string) => boolean): { familia: Familia; itens: RelatorioSpec[] }[] {
  return FAMILIAS
    .map((familia) => ({ familia, itens: RELATORIOS.filter((r) => r.familia === familia && pode(r.permissao)) }))
    // Categoria vazia não aparece: menu com item que não leva a lugar nenhum é
    // pior do que menu curto.
    .filter((g) => g.itens.length > 0)
}
