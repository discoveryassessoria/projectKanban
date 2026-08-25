// src/lib/ambiente/paises.ts
//
// AMBIENTE POR NACIONALIDADE — registro canônico (puro, sem React).
//
// REGRA DE ISOLAMENTO (definitiva): as variáveis --amb-* SÓ podem controlar
// propriedades VISUAIS do fundo/decoração (cor do overlay/véu, gradiente
// procedural do céu, acento decorativo, indicador contextual). NUNCA tamanho,
// espaçamento, layout, tipografia, largura, altura, overflow ou as superfícies
// institucionais dos componentes. Por isso paletaCss() NÃO expõe mais tokens de
// "vidro/borda/hover/skeleton" — eram o que tentava tingir superfícies e quebrava a UI.

export type PaisKey =
  | "italia"
  | "espanha"
  | "portugal"
  | "franca"
  | "alemanha"
  | "polonia"
  | "austria"

export interface AmbientePais {
  key: PaisKey
  iso: string
  label: string
  nacionalidade: string
  bandeira: string
  cidades: string[]
  /** Tokens OKLCH crus (sem `oklch()`) para permitir alpha via `/`. */
  tokens: {
    primaria: string
    secundaria: string
    acento: string
    indicador: string
    ceu1: string
    ceu2: string
    ceu3: string
  }
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "")

const ALIASES: Record<string, PaisKey> = {
  italia: "italia", italy: "italia", it: "italia", italiana: "italia",
  espanha: "espanha", espana: "espanha", spain: "espanha", es: "espanha", espanhola: "espanha",
  portugal: "portugal", pt: "portugal", portuguesa: "portugal",
  franca: "franca", france: "franca", fr: "franca", francesa: "franca",
  alemanha: "alemanha", germany: "alemanha", de: "alemanha", alema: "alemanha", alemao: "alemanha",
  polonia: "polonia", poland: "polonia", pl: "polonia", polonesa: "polonia",
  austria: "austria", at: "austria", austriaca: "austria",
}

export function normalizarPais(pais: string | null | undefined): PaisKey | null {
  if (!pais) return null
  const k = semAcento(String(pais).trim().toLowerCase())
  return ALIASES[k] ?? null
}

export const AMBIENTE_PAISES: Record<PaisKey, AmbientePais> = {
  italia: {
    key: "italia", iso: "IT", label: "Itália", nacionalidade: "Italiana", bandeira: "🇮🇹",
    cidades: ["veneza", "roma", "florenca", "toscana", "vaticano", "alpes"],
    tokens: { primaria: "0.34 0.075 155", secundaria: "0.66 0.11 75", acento: "0.42 0.06 55", indicador: "0.55 0.13 150", ceu1: "0.30 0.06 155", ceu2: "0.46 0.07 90", ceu3: "0.26 0.05 55" },
  },
  espanha: {
    key: "espanha", iso: "ES", label: "Espanha", nacionalidade: "Espanhola", bandeira: "🇪🇸",
    cidades: ["barcelona", "madrid", "sevilha", "toledo", "valencia"],
    tokens: { primaria: "0.45 0.15 32", secundaria: "0.75 0.13 85", acento: "0.62 0.10 70", indicador: "0.58 0.15 40", ceu1: "0.38 0.12 32", ceu2: "0.55 0.11 70", ceu3: "0.28 0.08 40" },
  },
  portugal: {
    key: "portugal", iso: "PT", label: "Portugal", nacionalidade: "Portuguesa", bandeira: "🇵🇹",
    cidades: ["lisboa", "porto", "sintra", "braga", "acores"],
    tokens: { primaria: "0.40 0.07 220", secundaria: "0.50 0.09 160", acento: "0.62 0.012 240", indicador: "0.55 0.10 175", ceu1: "0.34 0.06 220", ceu2: "0.44 0.07 175", ceu3: "0.26 0.03 235" },
  },
  franca: {
    key: "franca", iso: "FR", label: "França", nacionalidade: "Francesa", bandeira: "🇫🇷",
    cidades: ["paris", "lyon", "estrasburgo", "nice", "bordeaux"],
    tokens: { primaria: "0.32 0.10 265", secundaria: "0.65 0.012 265", acento: "0.96 0.005 265", indicador: "0.52 0.12 265", ceu1: "0.28 0.09 265", ceu2: "0.42 0.05 265", ceu3: "0.22 0.05 270" },
  },
  alemanha: {
    key: "alemanha", iso: "DE", label: "Alemanha", nacionalidade: "Alemã", bandeira: "🇩🇪",
    cidades: ["berlim", "munique", "colonia"],
    tokens: { primaria: "0.32 0.012 260", secundaria: "0.62 0.008 260", acento: "0.78 0.11 90", indicador: "0.72 0.10 90", ceu1: "0.26 0.012 260", ceu2: "0.40 0.02 90", ceu3: "0.20 0.008 260" },
  },
  polonia: {
    key: "polonia", iso: "PL", label: "Polônia", nacionalidade: "Polonesa", bandeira: "🇵🇱",
    cidades: ["varsovia", "cracovia"],
    tokens: { primaria: "0.45 0.05 245", secundaria: "0.66 0.02 245", acento: "0.58 0.12 25", indicador: "0.60 0.08 245", ceu1: "0.36 0.045 245", ceu2: "0.52 0.03 240", ceu3: "0.24 0.03 250" },
  },
  austria: {
    key: "austria", iso: "AT", label: "Áustria", nacionalidade: "Austríaca", bandeira: "🇦🇹",
    cidades: ["viena", "alpes"],
    tokens: { primaria: "0.38 0.11 20", secundaria: "0.64 0.008 20", acento: "0.95 0.004 20", indicador: "0.50 0.12 20", ceu1: "0.34 0.09 20", ceu2: "0.55 0.03 20", ceu3: "0.24 0.06 20" },
  },
}

/** Ambiente neutro (corporativo/institucional, sem país). Céu claro discreto. */
export const AMBIENTE_NEUTRO = {
  key: "neutro" as const,
  label: "Grupo Discovery",
  bandeira: "",
  tokens: {
    primaria: "0.30 0.03 250", secundaria: "0.55 0.02 250", acento: "0.70 0.02 250", indicador: "0.55 0.15 250",
    // Céu neutro CLARO — mantém a aparência institucional atual em telas corporativas.
    ceu1: "0.985 0.003 250", ceu2: "0.955 0.006 250", ceu3: "0.93 0.008 250",
  },
}

export function ambienteDoPais(pais: string | null | undefined): AmbientePais | null {
  const key = normalizarPais(pais)
  return key ? AMBIENTE_PAISES[key] : null
}

type Tokens = AmbientePais["tokens"]

/**
 * CSS custom properties do ambiente — SOMENTE decoração visual. Registradas com
 * @property em globals.css para INTERPOLAR durante o fade. Não há nenhuma
 * variável estrutural aqui.
 */
export function paletaCss(tokens: Tokens): React.CSSProperties {
  return {
    "--amb-primaria": `oklch(${tokens.primaria})`,
    "--amb-acento": `oklch(${tokens.acento})`,
    "--amb-indicador": `oklch(${tokens.indicador})`,
    "--amb-ceu-1": `oklch(${tokens.ceu1})`,
    "--amb-ceu-2": `oklch(${tokens.ceu2})`,
    "--amb-ceu-3": `oklch(${tokens.ceu3})`,
    // VÉU DE CONTRASTE — no tema claro ele é IVORY, não a cor do céu.
    //
    // Antes o véu era o próprio céu do país a 42%: escurecia a foto o suficiente
    // para o texto branco do dark glass ficar legível. Sobre um shell claro isso
    // faria o oposto — a paisagem competiria com o conteúdo.
    //
    // Agora é ivory quente em alta opacidade, e a foto aparece por baixo: presente
    // nas margens e nas áreas vazias, discreta atrás de tabela e formulário. A COR
    // DO PAÍS não some: continua em `--amb-primaria`/`--amb-acento`, que é onde ela
    // sempre identificou o ambiente.
    //
    // Não é `opacity` no contêiner — isso apagaria o conteúdo junto. É uma camada
    // própria, entre a foto e o shell.
    "--amb-scrim": "rgba(246, 243, 237, 0.90)",
  } as React.CSSProperties
}
