// src/lib/documentos/maioridade.ts
//
// POLÍTICA CANÔNICA DE MAIORIDADE — um lugar só.
//
// "Requerente adulto" aparece em regra documental, em bloqueio de fase e em
// relatório. Se cada um calculasse a própria idade, bastaria um deles usar
// `> 18` em vez de `>= 18`, ou contar por ano em vez de por data, para o sistema
// discordar de si mesmo sobre a mesma pessoa no mesmo dia.
//
// A data de referência é EXPLÍCITA e obrigatória: idade sem data de referência é
// uma pergunta mal feita — muda de resposta a cada meia-noite, e um teste que
// dependa de "hoje" quebra sozinho no aniversário de alguém.

/** Idade civil da maioridade no Brasil. Muda aqui, muda em todo lugar. */
export const IDADE_MAIORIDADE = 18

/**
 * Idade em anos COMPLETOS na data de referência.
 * Null quando não há data de nascimento — ausência de dado não é idade zero.
 */
export function idadeEmAnos(nascimento: Date | string | null | undefined, referencia: Date): number | null {
  if (!nascimento) return null
  const n = nascimento instanceof Date ? nascimento : new Date(nascimento)
  if (Number.isNaN(n.getTime())) return null
  let anos = referencia.getUTCFullYear() - n.getUTCFullYear()
  const mes = referencia.getUTCMonth() - n.getUTCMonth()
  // ainda não fez aniversário no ano de referência
  if (mes < 0 || (mes === 0 && referencia.getUTCDate() < n.getUTCDate())) anos--
  return anos < 0 ? null : anos
}

/**
 * Atingiu a maioridade na data de referência?
 *
 * Sem data de nascimento devolve `null` — e null NÃO é "menor". Quem consome
 * decide o que fazer com o desconhecido; tratar ausência como menoridade faria o
 * sistema deixar de exigir documentos de um adulto por falta de cadastro.
 */
export function ehMaiorDeIdade(nascimento: Date | string | null | undefined, referencia: Date): boolean | null {
  const anos = idadeEmAnos(nascimento, referencia)
  return anos == null ? null : anos >= IDADE_MAIORIDADE
}

// ── DOMÍNIO CANÔNICO DE `Pessoa.requerente` ─────────────────────────────────
// O campo é string com quatro valores: "sim" | "maior" | "menor" | "nao".
// `linhagem.ts` e `operational-projection.ts` já tratam "maior" e "menor" como
// requerente — só o contexto documental exigia "sim", e por isso um requerente
// marcado "maior" não era reconhecido por regra documental nenhuma.
//
// O marcador também carrega MAIORIDADE, e essa é a informação que de fato existe
// no cadastro: `data_nasc` é nulo na maior parte da base. Por isso a maioridade
// é resolvida pela data quando ela existe e pelo marcador quando não existe —
// nesta ordem, porque a data é o fato e o marcador é a declaração.

export type MarcadorRequerente = "sim" | "maior" | "menor" | "nao"

export function ehRequerente(marcador: string | null | undefined): boolean {
  const m = String(marcador ?? "nao").trim().toLowerCase()
  return m === "sim" || m === "maior" || m === "menor"
}

/**
 * Maioridade a partir do marcador. "sim" não informa idade — devolve null, e
 * null é desconhecido, nunca "menor".
 */
export function maioridadePeloMarcador(marcador: string | null | undefined): boolean | null {
  const m = String(marcador ?? "").trim().toLowerCase()
  if (m === "maior") return true
  if (m === "menor") return false
  return null
}

/** Maioridade efetiva: a DATA manda; sem data, vale o marcador do cadastro. */
export function maioridadeEfetiva(
  nascimento: Date | string | null | undefined,
  marcador: string | null | undefined,
  referencia: Date,
): boolean | null {
  return ehMaiorDeIdade(nascimento, referencia) ?? maioridadePeloMarcador(marcador)
}

// ── CLASSIFICAÇÃO EXIBÍVEL / VALOR EFETIVO DA PESSOA ────────────────────────
// UMA função para tudo que precisa saber "maior ou menor?" de uma Pessoa: motor
// documental, propagação, relatórios, financeiro e telas. O campo gravado
// (`Pessoa.requerente`: "maior"/"menor") continua existindo — é a DECLARAÇÃO
// que vale só quando não há data de nascimento. Havendo data, o valor efetivo é
// SEMPRE o calculado, e o seletor manual some da tela.
//
//   data válida            → CALCULADA (>= 18 anos na referência = maior)
//   sem data, marcador     → DECLARADA ("maior" | "menor" do cadastro antigo)
//   sem data, sem marcador → A_CLASSIFICAR (desconhecido — nunca "menor")
//
// Data futura não é data de nascimento válida: cai em "sem data".

export type EstadoMaioridade = "MAIOR" | "MENOR" | "A_CLASSIFICAR"
export type OrigemMaioridade = "CALCULADA" | "DECLARADA" | "NENHUMA"

export interface ClassificacaoMaioridade {
  estado: EstadoMaioridade
  origem: OrigemMaioridade
  /** true/false quando conhecido; null = a classificar. */
  maior: boolean | null
  /** Anos completos na referência (só quando há data válida). */
  idade: number | null
}

export function classificarMaioridade(
  nascimento: Date | string | null | undefined,
  marcador: string | null | undefined,
  referencia: Date,
): ClassificacaoMaioridade {
  const idade = idadeEmAnos(nascimento, referencia)
  if (idade != null) {
    const maior = idade >= IDADE_MAIORIDADE
    return { estado: maior ? "MAIOR" : "MENOR", origem: "CALCULADA", maior, idade }
  }
  const declarada = maioridadePeloMarcador(marcador)
  if (declarada != null) {
    return { estado: declarada ? "MAIOR" : "MENOR", origem: "DECLARADA", maior: declarada, idade: null }
  }
  return { estado: "A_CLASSIFICAR", origem: "NENHUMA", maior: null, idade: null }
}

/** O seletor manual de maior/menor só existe quando NÃO há data válida para calcular. */
export function maioridadeEhManual(nascimento: Date | string | null | undefined, referencia: Date): boolean {
  return idadeEmAnos(nascimento, referencia) == null
}

export const ROTULO_MAIORIDADE: Record<EstadoMaioridade, string> = {
  MAIOR: "Maior de idade",
  MENOR: "Menor de idade",
  A_CLASSIFICAR: "A classificar",
}

/**
 * Marcador a gravar em `Pessoa.requerente` quando a pessoa É requerente: com data
 * válida o campo acompanha o cálculo ("maior"/"menor"); sem data, preserva o que o
 * usuário declarou (ou "sim" = a classificar). Quem não é requerente devolve o
 * valor recebido intacto.
 */
export function marcadorRequerenteParaGravar(
  nascimento: Date | string | null | undefined,
  marcadorAtual: string | null | undefined,
  referencia: Date,
): string {
  const atual = String(marcadorAtual ?? "nao").trim().toLowerCase()
  if (!ehRequerente(atual)) return atual
  const idade = idadeEmAnos(nascimento, referencia)
  if (idade == null) return atual
  return idade >= IDADE_MAIORIDADE ? "maior" : "menor"
}

/**
 * Nascimento igual ou anterior a esta data = maior de idade em `referencia`.
 * Filtro de banco ("menor de idade") usa isto em vez de refazer a conta de 18 anos.
 */
export function dataLimiteMaioridade(referencia: Date): Date {
  return new Date(Date.UTC(referencia.getUTCFullYear() - IDADE_MAIORIDADE, referencia.getUTCMonth(), referencia.getUTCDate(), 23, 59, 59, 999))
}

/** Data em que a pessoa completa (ou completou) a maioridade; null sem data válida. */
export function dataDaMaioridade(nascimento: Date | string | null | undefined): Date | null {
  if (!nascimento) return null
  const n = nascimento instanceof Date ? nascimento : new Date(nascimento)
  if (Number.isNaN(n.getTime())) return null
  return new Date(Date.UTC(n.getUTCFullYear() + IDADE_MAIORIDADE, n.getUTCMonth(), n.getUTCDate()))
}

export interface AvisoMaioridade {
  /** "COMPLETOU": 18 anos completos DEPOIS de `desde`. "COMPLETARA": completa até `ate`. */
  tipo: "COMPLETOU" | "COMPLETARA"
  quando: Date
}

/**
 * Aviso derivado (calculado na leitura, sem tabela): a pessoa que era menor ao
 * abrir o processo (`desde`) e atingiu 18 anos até `hoje` — a documentação exigida
 * dela pode ter mudado —, ou que atinge 18 anos nos próximos `diasAFrente` dias.
 */
export function avisoDeMaioridade(
  nascimento: Date | string | null | undefined,
  desde: Date,
  hoje: Date,
  diasAFrente = 60,
): AvisoMaioridade | null {
  const dia18 = dataDaMaioridade(nascimento)
  if (!dia18) return null
  if (idadeEmAnos(nascimento, hoje) == null) return null // data futura
  const limite = new Date(hoje.getTime() + diasAFrente * 86_400_000)
  if (dia18.getTime() > desde.getTime() && dia18.getTime() <= hoje.getTime()) return { tipo: "COMPLETOU", quando: dia18 }
  if (dia18.getTime() > hoje.getTime() && dia18.getTime() <= limite.getTime()) return { tipo: "COMPLETARA", quando: dia18 }
  return null
}
