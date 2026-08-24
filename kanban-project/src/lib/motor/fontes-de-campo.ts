// src/lib/motor/fontes-de-campo.ts
// ============================================================================
// DE ONDE UM CAMPO TIRA O QUE OFERECE — o vocabulário fechado, num lugar só.
//
// ─── DUAS COISAS QUE PARECEM UMA ────────────────────────────────────────────
// Existiam duas maneiras de um campo buscar conteúdo fora do próprio passo. Uma
// estava implementada (`{ catalogo: "canais" }`); a outra faltava, e a falta era o
// motivo de a Retificação não conseguir perguntar qual órgão recebeu o pedido.
//
// Elas NÃO são a mesma coisa, e tratá-las como se fossem produziria o erro que este
// arquivo existe para evitar:
//
//   DATASOURCE — o campo é uma ESCOLHA, e a lista de escolhas mora num cadastro
//     global em vez de estar repetida dentro do passo. O valor gravado é a CHAVE da
//     opção (`"portal"`), que é identidade imutável. É o caso do canal.
//
//   REFERÊNCIA — o campo APONTA para uma entidade que existe por conta própria, tem
//     dono, ciclo de vida e nome que muda. O valor gravado é o ID canônico, e o nome
//     é lido do cadastro a cada leitura. É o caso da organização.
//
// A diferença decide o que acontece quando o cadastro muda. Renomear um canal não
// mexe no valor `"portal"`; renomear uma organização precisa aparecer em toda
// execução que a escolheu, sem regravar nenhuma. Se o órgão virasse datasource, o
// nome entraria como valor e congelaria — a segunda fonte de novo.
//
// ─── POR QUE NUM ARQUIVO SÓ ─────────────────────────────────────────────────
// Porque a alternativa é o que já estava começando a acontecer: `catalogo: "x"`
// espalhado, cada entidade nova ganhando o seu, e ninguém conseguindo responder
// quais existem. Aqui as duas espécies são declaradas juntas, com chave tipada, e
// quem administra escolhe de uma lista — não digita nome de tabela.
//
// Acrescentar uma fonte é mudança de código, igual ao catálogo de efeitos: existe
// porque alguém escreveu o resolvedor. O que não pode exigir código é combinar as
// que existem.
// ============================================================================

/** Política de escopo por cliente. O Discovery é instância única — não há tenant. */
export const ESCOPO_MULTI_CLIENTE = "NAO_SE_APLICA" as const

// ─── REFERÊNCIAS: o valor é o ID de uma entidade canônica ───────────────────

export interface AlvoDeReferencia {
  /** Como o alvo se chama para quem administra. */
  label: string
  /** O que o campo pergunta ao operador, em português. */
  descricao: string
  /** Modelo canônico que responde. Declarado para o guard conferir. */
  entidade: string
  /** Permissão exigida de quem escolhe uma entidade deste alvo. */
  permissao: string
  /**
   * Uma execução NOVA pode apontar para entidade inativa?
   *
   * Não — quem foi desativado saiu de circulação. O histórico é outra pergunta, e a
   * resposta dele é sempre sim: o que já foi escolhido continua resolvendo.
   */
  aceitaInativaEmNovaExecucao: boolean
  /** Onde quem administra mantém o cadastro, para a mensagem de erro ajudar. */
  rotaDoCadastro: string
  escopoMultiCliente: typeof ESCOPO_MULTI_CLIENTE
}

export const ALVOS_DE_REFERENCIA = {
  ORGANIZACAO: {
    label: "Órgãos e Organizações",
    descricao: "Aponta para uma organização cadastrada — órgão, cartório, tribunal, fornecedor.",
    entidade: "OrgaoProtocolo",
    permissao: "processos.editar",
    aceitaInativaEmNovaExecucao: false,
    rotaDoCadastro: "/administrator?modulo=base&aba=organizacoes",
    escopoMultiCliente: ESCOPO_MULTI_CLIENTE,
  },
  PROFISSIONAL: {
    label: "Profissionais",
    descricao: "Aponta para um profissional cadastrado — advogado, tradutor, despachante.",
    entidade: "Profissional",
    permissao: "processos.editar",
    aceitaInativaEmNovaExecucao: false,
    rotaDoCadastro: "/administrator?modulo=base&aba=profissionais",
    escopoMultiCliente: ESCOPO_MULTI_CLIENTE,
  },
} as const satisfies Record<string, AlvoDeReferencia>

export type ChaveDeAlvo = keyof typeof ALVOS_DE_REFERENCIA
export const CHAVES_DE_ALVO = Object.keys(ALVOS_DE_REFERENCIA) as ChaveDeAlvo[]

export function alvoDeReferencia(k: string | null | undefined): AlvoDeReferencia | null {
  if (!k) return null
  return (ALVOS_DE_REFERENCIA as Record<string, AlvoDeReferencia>)[k] ?? null
}

// ─── DATASOURCES: o valor é a chave da opção ────────────────────────────────

export interface FonteDeOpcoes {
  label: string
  descricao: string
  entidade: string
  escopoMultiCliente: typeof ESCOPO_MULTI_CLIENTE
}

export const FONTES_DE_OPCOES = {
  /**
   * O canal veio antes desta separação existir e continua sendo o que sempre foi: uma
   * escolha cujo valor é a chave. Está declarado aqui — e não migrado para referência —
   * porque migrá-lo trocaria `"portal"` por um ID em 21 versões publicadas e nas
   * execuções que já as registraram, sem que nada melhorasse.
   */
  canais: {
    label: "Canais operacionais",
    descricao: "As opções são os canais cadastrados; o valor gravado é a chave do canal.",
    entidade: "CanalOperacional",
    escopoMultiCliente: ESCOPO_MULTI_CLIENTE,
  },
} as const satisfies Record<string, FonteDeOpcoes>

export type ChaveDeFonte = keyof typeof FONTES_DE_OPCOES
export const CHAVES_DE_FONTE = Object.keys(FONTES_DE_OPCOES) as ChaveDeFonte[]

// ─── LEITURA DA DECLARAÇÃO ──────────────────────────────────────────────────
//
// A declaração mora em `StepField.opcoes`, que já era o lugar do ponteiro
// `{ catalogo: "canais" }`. Reaproveitar a coluna evita uma segunda coluna dizendo a
// mesma coisa — e evita a migration que viria junto dela.

export type DeclaracaoDeFonte =
  | { especie: "REFERENCIA"; alvo: string }
  | { especie: "DATASOURCE"; fonte: string }
  | null

export function fonteDoCampo(opcoes: unknown): DeclaracaoDeFonte {
  if (!opcoes || Array.isArray(opcoes) || typeof opcoes !== "object") return null
  const o = opcoes as { referencia?: unknown; catalogo?: unknown }
  if (typeof o.referencia === "string" && o.referencia.trim() !== "") {
    return { especie: "REFERENCIA", alvo: o.referencia.trim() }
  }
  if (typeof o.catalogo === "string" && o.catalogo.trim() !== "") {
    return { especie: "DATASOURCE", fonte: o.catalogo.trim() }
  }
  return null
}

/** O alvo declarado por um campo de referência — `null` se ele não declara nenhum. */
export function alvoDoCampo(opcoes: unknown): string | null {
  const f = fonteDoCampo(opcoes)
  return f?.especie === "REFERENCIA" ? f.alvo : null
}

/**
 * O ID canônico que um campo de referência guarda. NUNCA um nome.
 *
 * Aceita número e string de dígitos porque o formulário devolve string; qualquer
 * outra coisa é recusada aqui, antes de virar consulta.
 */
export function idReferenciado(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isInteger(valor) && valor > 0 ? valor : null
  if (typeof valor === "string" && /^\d+$/.test(valor.trim())) {
    const n = Number(valor.trim())
    return Number.isSafeInteger(n) && n > 0 ? n : null
  }
  return null
}
