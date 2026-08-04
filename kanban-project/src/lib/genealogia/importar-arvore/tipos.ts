// src/lib/genealogia/importar-arvore/tipos.ts
// ============================================================================
// CONTRATO da importação de árvore por imagem.
//
// A entrada NÃO é certidão bruta: é o print de uma árvore JÁ MONTADA fora do
// sistema, com cada pessoa num card estruturado. A tarefa da IA aqui é
// TRANSCREVER o que está escrito, não investigar nem inferir vínculo — foi a
// investigação que tornou a tentativa anterior (revertida em 71e70e51) cara
// demais em tokens.
//
// Os nomes de campo abaixo são os do model `Pessoa`/`Uniao` do Prisma, não
// rótulos de tela. Isso mantém a extração colada no destino: o que sai daqui
// entra em POST /api/pessoas e POST /api/unioes sem tradução no meio.
// ============================================================================

/** Uma pessoa lida de um card da imagem. Todos os campos exceto `ref` e `nome` são opcionais — card cortado ou ilegível devolve o que deu para ler. */
export interface PessoaExtraida {
  /**
   * Identificador LOCAL da extração (ex.: "p1", "p2"). Não é id de banco: só
   * serve para `paiRef`/`maeRef`/`conjugeRef` apontarem entre si antes de
   * qualquer coisa existir no banco.
   */
  ref: string

  // ── Identificação (→ Pessoa) ──────────────────────────────────────────────
  nome: string
  sobrenome?: string | null
  /** "masculino" | "feminino" — o schema aceita VarChar(10) livre. */
  sexo?: string | null

  // ── Nascimento (→ Pessoa) ─────────────────────────────────────────────────
  /** ISO 8601 (YYYY-MM-DD). Data parcial ou ilegível deve vir null, nunca inventada. */
  data_nasc?: string | null
  /** "Cidade de Nascimento" no formulário manual. */
  local_nasc?: string | null
  estado_nasc?: string | null
  pais_nasc?: string | null
  nacionalidade?: string | null

  // ── Falecimento (→ Pessoa) ────────────────────────────────────────────────
  data_obito?: string | null
  /**
   * ATENÇÃO: `Pessoa` NÃO tem coluna de local de falecimento. Este campo é
   * extraído mas HOJE NÃO É GRAVADO — ver `local_obito` em MAPEAMENTO.md.
   * Mantido no contrato para não perder o dado da leitura; gravar exige
   * migration.
   */
  local_obito?: string | null

  // ── Linhagem (→ Pessoa) ───────────────────────────────────────────────────
  numeroLinhagem?: number | null

  // ── Parentesco — o dado mais crítico ──────────────────────────────────────
  /** `ref` do pai dentro desta mesma extração. */
  paiRef?: string | null
  /** `ref` da mãe dentro desta mesma extração. */
  maeRef?: string | null
}

/** Um casamento lido da imagem (→ Uniao). */
export interface UniaoExtraida {
  /** `ref` de um dos cônjuges. */
  pessoa1Ref: string
  /** `ref` do outro cônjuge. */
  pessoa2Ref: string
  /** Data do casamento — ISO 8601. Vira `Uniao.data_inicio`. */
  data_inicio?: string | null
  /** Local do casamento. Vira `Uniao.local`. */
  local?: string | null
  estado?: string | null
  pais?: string | null
}

/** O que a extração devolve. */
export interface ExtracaoArvore {
  pessoas: PessoaExtraida[]
  unioes: UniaoExtraida[]
  /**
   * Observações da leitura para o operador decidir na prévia: card cortado,
   * data ambígua, nome parcialmente legível. NÃO é análise do caso (robustez,
   * elo sem documento) — isso está fora de escopo de propósito.
   */
  avisos: string[]
}

/** Entrada da extração. */
export interface EntradaExtracao {
  /** Imagem do print, já em base64 (sem o prefixo `data:`). */
  imagemBase64: string
  /** MIME real da imagem — o provedor de visão exige o tipo correto. */
  mimeType: string
  /** Texto complementar opcional, digitado pelo operador para desambiguar. */
  textoComplementar?: string | null
}

/**
 * A ÚNICA porta para a IA. Trocar de provedor, de modelo ou de estratégia de
 * prompt acontece atrás desta assinatura — a rota, a prévia e a gravação não
 * sabem que ela existe.
 */
export type ExtratorDeArvore = (entrada: EntradaExtracao) => Promise<ExtracaoArvore>
