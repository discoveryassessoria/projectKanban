// src/components/arvore/motor/tokens.ts
//
// Tokens visuais da árvore.
//
// DECISÃO DE SUPERFÍCIE (permanente para este módulo): o canvas da árvore é uma
// SUPERFÍCIE CLARA, por determinação de produto — a referência da experiência é
// a árvore do FamilySearch, e ali o papel é branco. Não é preferência estética:
// árvore genealógica é documento de leitura, lida por muito tempo seguido, com
// muito texto pequeno (nome, datas, lugar). Fundo escuro com grade pontilhada
// comunica "editor de nós/engenharia", que é exatamente a leitura errada.
//
// O que continua sendo Discovery:
//   · o ACENTO institucional (dourado) em seleção, foco e navegação ativa;
//   · a semântica de estado (severidade, sucesso, informação);
//   · a identidade de linha por país;
//   · tipografia, espaçamento e gramática de componente do DS.
//
// O que muda: as superfícies e as bordas deste módulo são claras e literais, e
// não seguem os tokens escuros globais — se seguissem, o canvas voltaria a ser
// preto. Fora daqui nada é afetado: nenhuma outra tela lê este arquivo.

export const TREE = {
  /** Papel do canvas — cinza quase branco, sem grade, sem textura. */
  fundo: "#f4f5f6",
  /** Mantido só para compatibilidade de assinatura; a grade foi removida. */
  grade: "transparent",
  /** Card: papel branco sobre o papel do canvas. */
  cartao: "#ffffff",
  cartaoBorda: "#d9dcdf",
  cartaoBordaForte: "#b8bdc2",
  /** Painéis e menus flutuantes — brancos, com sombra em vez de borda forte. */
  popover: "#ffffff",
  painel: "#ffffff",
  hover: "#f0f2f4",
  ativo: "#e6e9ec",
  texto: "#1f2328",
  textoFraco: "#5b6470",
  textoSuave: "#8a929c",
  /** Conector: cinza discreto, presente sem competir com o nome. */
  conector: "#c4c9ce",
  /** Acento institucional Discovery — seleção, foco, navegação ativa. */
  acento: "var(--accent-primary, #d2a948)",
  /** Versão legível como TEXTO sobre branco (o dourado puro não tem contraste). */
  acentoTexto: "#8a6a17",
  acentoTinta: "#3d2f08",
  acentoSuave: "color-mix(in srgb, var(--accent-primary, #d2a948) 22%, #ffffff)",
  /**
   * Conector da linha em destaque.
   *
   * Era o dourado institucional cheio, e com a ascendência inteira acesa isso
   * virava um traçado forte atravessando a tela — o conector passava a competir
   * com os nomes, que é o oposto do papel dele. Um cinza-escuro dá a mesma
   * leitura "esta é a linha" sem virar neon; o acento continua marcando
   * SELEÇÃO, que é pontual.
   */
  conectorAtivo: "#6b7280",
  /** Elevação discreta, no espírito do papel: sombra curta e clara. */
  sombra: "0 1px 2px rgba(16,24,40,0.06)",
  sombraElevada: "0 6px 16px -6px rgba(16,24,40,0.18), 0 2px 4px rgba(16,24,40,0.06)",
  sombraPainel: "0 10px 30px -12px rgba(16,24,40,0.25)",
  /** Véu do modal de busca — escurece o canvas sem apagá-lo. */
  veu: "rgba(16,24,40,0.32)",
  branco: "#ffffff",
  /** Superfície de placeholder ("adicionar", setor de leque vazio). */
  vazio: "#fafbfc",
  /** Lavagem da trilha de ascendência/descendência do selecionado. */
  trilhaAscendente: "#fbf7ec",
  trilhaDescendente: "#f2f6fb",
} as const

/**
 * Cor de gênero — recalibrada para papel branco.
 *
 * Convenção universal de genealogia (e a do FamilySearch): azul para masculino,
 * rosa para feminino, cinza para não informado. Entra como faixa fina e como
 * cor do ícone — nunca como fundo do card, que descaracterizaria o papel.
 */
export const GENERO: Record<
  "masculino" | "feminino" | "indefinido",
  { linha: string; suave: string; tinta: string }
> = {
  masculino: { linha: "#3b82c4", suave: "#eaf2fa", tinta: "#1f5b93" },
  feminino: { linha: "#c4548a", suave: "#fbeef4", tinta: "#94356a" },
  indefinido: { linha: "#9aa3ad", suave: "#f1f3f5", tinta: "#5b6470" },
}

export function corGenero(sexo: string | null | undefined) {
  const s = (sexo || "").trim().toLowerCase()
  if (s.startsWith("m")) return GENERO.masculino
  if (s.startsWith("f")) return GENERO.feminino
  return GENERO.indefinido
}

/** Severidade → cor, em versões legíveis sobre branco. */
export const SEVERIDADE_COR: Record<string, string> = {
  critico: "#c02b2b",
  alto: "#c2620f",
  medio: "#9a7209",
  baixo: "#2b6ca3",
  info: "#8a929c",
}

export const SEVERIDADE_ROTULO: Record<string, string> = {
  critico: "Crítico",
  alto: "Alto",
  medio: "Médio",
  baixo: "Baixo",
  info: "Informativo",
}

export const SUCESSO = "#2f8a4e"
export const INFO = "#2b6ca3"
export const SUCESSO_SUAVE = "#e9f5ed"

/**
 * Escalas do leque.
 *
 * TONS_GERACAO: um tom por anel, todos claros o bastante para o nome continuar
 * legível por cima. Não é paleta decorativa — é o que permite contar gerações
 * de relance num desenho onde nenhum setor cabe um rótulo de geração.
 *
 * TONS_COMPLETUDE: escala de UM matiz (saturação crescente), nunca
 * verde→vermelho. Estado não pode depender de distinguir matiz, e o número
 * exato continua disponível no cartão rápido.
 */
export const TONS_GERACAO = [
  "#eef3f8",
  "#e6eff7",
  "#e9f2ec",
  "#f5f0e4",
  "#f6ecec",
  "#f0ecf6",
  "#eaf1f2",
  "#f3f1e8",
] as const

export const TONS_COMPLETUDE = {
  alta: "#ffffff",
  boa: "#f7f4ea",
  media: "#f3ecd8",
  baixa: "#efe3c4",
  critica: "#ead9ae",
} as const

/** Identidade da linha de cidadania por país — tons legíveis sobre branco. */
export const PAIS_LINHA: Record<string, { cor: string; rotulo: string; sigla: string }> = {
  ITALIA: { cor: "#2f8a4e", rotulo: "Linha italiana", sigla: "IT" },
  PORTUGAL: { cor: "#b3352f", rotulo: "Linha portuguesa", sigla: "PT" },
  ESPANHA: { cor: "#9a7209", rotulo: "Linha espanhola", sigla: "ES" },
  ALEMANHA: { cor: "#4a5259", rotulo: "Linha alemã", sigla: "DE" },
}

export const CATEGORIA_ROTULO: Record<string, string> = {
  conflito: "Conflito",
  duplicidade: "Duplicidade",
  lacuna: "Pendência",
  relacao: "Sugestão de vínculo",
  pesquisa: "Pesquisa",
  migracao: "Migração",
  sobrenome: "Sobrenome",
  risco: "Risco do processo",
}

/** Curvas de animação. Uma linguagem só de movimento em toda a árvore. */
export const EASE = {
  /** Entrada/saída de elementos — natural, sem overshoot. */
  suave: "cubic-bezier(0.22, 1, 0.36, 1)",
  /** Movimento de câmera — desacelera forte no fim, sensação de peso. */
  camera: "cubic-bezier(0.16, 1, 0.3, 1)",
  /** Micro feedback (hover, press). */
  rapido: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const

export const DURACAO = {
  micro: 120,
  curta: 200,
  media: 320,
  camera: 520,
} as const

/**
 * Folha única da árvore.
 *
 * Além do movimento reduzido, ela carrega as CLASSES DE ESTADO (hover, foco).
 * Motivo: classe utilitária com cor entre colchetes espalha hexadecimal por
 * dezenas de componentes, e a regra do módulo — verificada por teste — é que
 * cor só existe neste arquivo. Com `.arv-hover` o componente declara o
 * COMPORTAMENTO e a cor continua morando num lugar só.
 */
export const CSS_MOVIMENTO_REDUZIDO = `
.arv-hover { transition: background-color 150ms cubic-bezier(0.4,0,0.2,1); }
.arv-hover:hover:not(:disabled) { background-color: #f0f2f4; }
.arv-hover-suave { transition: background-color 150ms cubic-bezier(0.4,0,0.2,1); }
.arv-hover-suave:hover:not(:disabled) { background-color: #f4f6f7; }

@media (prefers-reduced-motion: reduce) {
  [data-arvore] *,
  [data-arvore-overlay] * {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
`

/**
 * Dimensões do card.
 *
 * A LARGURA é fixa: nome de pessoa precisa da mesma caixa em qualquer leitura,
 * e largura variável faria a árvore inteira reflowar a cada opção marcada.
 *
 * A ALTURA é derivada do que o operador escolheu mostrar. Não existe "densidade
 * compacta/confortável" — isso era invenção minha. O que existe é escolher QUAIS
 * INFORMAÇÕES o card carrega; o tamanho é consequência disso, nunca um ajuste
 * solto de tamanho.
 */
export const CARTAO_LARGURA = 288

/**
 * Card da vista RETRATO — proporção invertida.
 *
 * Na leitura em pé a largura é o recurso escasso (as gerações se empilham e os
 * irmãos disputam o eixo horizontal). Um card estreito e alto cabe o dobro de
 * gente na mesma faixa; o deitado obrigava pan horizontal numa leitura que
 * deveria ser só vertical.
 */
export const RETRATO_LARGURA = 78

export function alturaCardRetrato(e: ConteudoCartao): number {
  let h = 10 + 28 // respiro + nome em duas linhas
  if (e.retratos) h += 46
  if (e.datas) h += 13
  if (e.codigos) h += 12
  return Math.max(h, 74)
}

export interface ConteudoCartao {
  retratos: boolean
  datas: boolean
  lugares: boolean
  codigos: boolean
}

export function alturaCard(e: ConteudoCartao): number {
  // 22 de respiro + 17 do nome + as linhas que o operador ligou.
  let h = 22 + 17
  if (e.datas || e.codigos) h += 15
  if (e.lugares) h += 14
  // Um retrato de 30px não cabe em card de 39px de conteúdo.
  return e.retratos ? Math.max(h, 64) : Math.max(h, 46)
}

/**
 * FOLGAS DO DESENHO — por orientação, não por "densidade".
 *
 * As duas leituras têm economias opostas e por isso não podem compartilhar os
 * mesmos números. Na leitura EM PÉ a largura é o recurso escasso: os irmãos
 * disputam o eixo horizontal, então o casal fica quase encostado (o par se lê
 * como par pela proximidade) e a folga sobra para separar FAMÍLIAS. Na leitura
 * DEITADA a altura é que é escassa, e o casal ocupa duas linhas empilhadas —
 * ali a folga conjugal precisa ser VISÍVEL, porque é ela que garante que marido
 * e mulher sejam lidos como dois cards e não como um bloco só.
 *
 * `casal` nunca pode ser 0: dois cônjuges colados voltariam a parecer um card
 * de casal, que é justamente o que este módulo não faz.
 */
export interface FolgasLayout {
  /** Entre slots vizinhos da mesma geração (famílias/irmãos). */
  ordem: number
  /** Entre os dois cards de um casal. */
  casal: number
  /** Entre gerações. */
  camada: number
}

export const FOLGAS: Record<"vertical" | "horizontal", FolgasLayout> = {
  vertical: { ordem: 46, casal: 8, camada: 58 },
  // Na deitada a folga conjugal é MAIOR do que parece necessário de propósito:
  // ela precisa caber o rótulo do casamento (data e lugar), que é dado da
  // UNIÃO e por isso não pode morar dentro do card de nenhum dos dois. Mesmo
  // assim continua menor que a folga entre famílias (56), que é o que mantém o
  // par legível como par.
  horizontal: { ordem: 56, casal: 32, camada: 74 },
}

/**
 * Controles flutuantes — a régua da referência.
 *
 * Não é barra: são caixas brancas independentes flutuando sobre o papel, no
 * canto superior direito. O tamanho é o que permite alvo de clique confortável
 * sem virar mobília: 34px de lado, ícone de 17px.
 */
export const CONTROLE = {
  altura: 34,
  raio: 6,
  icone: 17,
  folga: 6,
  margem: 16,
} as const

/** Minimapa — moldura do canto inferior esquerdo. */
export const MINIMAPA = {
  largura: 264,
  altura: 190,
  margem: 16,
  raio: 4,
  /** Moldura cinza da referência: o mapa é um objeto, não parte do papel. */
  moldura: "#b9bec3",
  molduraLargura: 10,
  papel: "#eef0f1",
  viewport: "#5b6470",
} as const

/** Gaveta lateral da pessoa. */
export const GAVETA_LARGURA = 400
