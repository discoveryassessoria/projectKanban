// src/lib/cadastro-mestre/afirmacao.ts
//
// CONTRATO DE AFIRMAÇÃO AUDITÁVEL — vale para os SEIS domínios genealógicos.
//
// Complemento 2 da arquitetura aprovada: "o Discovery nunca deve transformar
// uma hipótese em fato silenciosamente". Toda inferência — hipótese, pesquisa,
// relação, data aproximada, evento aproximado — carrega obrigatoriamente:
//
//   origem · grau de confiança · responsável · data · justificativa · auditoria
//
// Este módulo define esses seis campos UMA vez. Nenhum domínio redefine a sua
// própria escala de confiança: escala divergente entre domínios é o que faz
// "provável" significar coisas diferentes em duas telas do mesmo sistema.
//
// É puro de propósito — sem Prisma, sem rede. As regras de promoção são
// testáveis sem banco, que é onde elas precisam estar corretas.

/**
 * De onde a afirmação veio. Ordenada da mais forte para a mais fraca — a ordem
 * importa porque promoção de confiança depende dela.
 */
export type OrigemAfirmacao =
  | "DOCUMENTO"        // certidão, registro civil, livro paroquial
  | "OPERADOR"         // afirmação humana com base em análise
  | "IMPORTACAO"       // veio de dado legado ou arquivo externo
  | "REQUERENTE"       // declarado pelo cliente
  | "MOTOR"            // regra determinística do sistema
  | "IA"               // sugestão de modelo — NUNCA vira fato sozinha

export const ROTULO_ORIGEM: Record<OrigemAfirmacao, string> = {
  DOCUMENTO: "Documento oficial",
  OPERADOR: "Análise do operador",
  IMPORTACAO: "Importação",
  REQUERENTE: "Declarado pelo requerente",
  MOTOR: "Regra do sistema",
  IA: "Sugestão de IA",
}

/** Escala única de confiança do Discovery. */
export type GrauConfianca = "CONFIRMADO" | "PROVAVEL" | "HIPOTESE" | "CONTESTADO"

export const ROTULO_CONFIANCA: Record<GrauConfianca, string> = {
  CONFIRMADO: "Confirmado",
  PROVAVEL: "Provável",
  HIPOTESE: "Hipótese",
  CONTESTADO: "Contestado",
}

/** Peso para comparação. `CONTESTADO` é o mais fraco: é afirmação sob disputa. */
const PESO: Record<GrauConfianca, number> = {
  CONFIRMADO: 3,
  PROVAVEL: 2,
  HIPOTESE: 1,
  CONTESTADO: 0,
}

export function maisForte(a: GrauConfianca, b: GrauConfianca): GrauConfianca {
  return PESO[a] >= PESO[b] ? a : b
}

export function ehPeloMenos(atual: GrauConfianca, minimo: GrauConfianca): boolean {
  return PESO[atual] >= PESO[minimo]
}

/**
 * Confiança mínima para uma afirmação sustentar a linha de cidadania.
 * Hipótese e afirmação contestada não sustentam processo — é a regra que
 * impede o escritório de protocolar em cima de suposição.
 */
export const MINIMO_PARA_LINHA: GrauConfianca = "PROVAVEL"

/** Os seis campos obrigatórios. Toda tabela dos seis domínios os carrega. */
export interface AfirmacaoAuditavel {
  origem: OrigemAfirmacao
  confianca: GrauConfianca
  /** Usuário responsável. Null só é aceito quando a origem é MOTOR ou IMPORTACAO. */
  responsavelId: number | null
  /** Quando a afirmação foi feita — não é o `createdAt` da linha. */
  afirmadoEm: Date
  /** Por que se afirma isso. Obrigatória fora de DOCUMENTO. */
  justificativa: string | null
  /** Evidência que sustenta (NecessidadeDocumental). Obrigatória em CONFIRMADO. */
  evidenciaNecessidadeId: number | null
}

export type ResultadoValidacao =
  | { valido: true }
  | { valido: false; codigo: CodigoViolacao; mensagem: string }

export type CodigoViolacao =
  | "IA_NAO_CONFIRMA"
  | "CONFIRMADO_SEM_EVIDENCIA"
  | "SEM_RESPONSAVEL"
  | "SEM_JUSTIFICATIVA"
  | "PROMOCAO_SEM_EVIDENCIA"
  | "PROMOCAO_DE_CONTESTADO"

/**
 * Valida uma afirmação antes de persistir. Estas cinco regras são a tradução
 * literal do complemento 2 — se qualquer uma passar, uma hipótese vira fato
 * sem ninguém assinar embaixo.
 */
export function validarAfirmacao(a: AfirmacaoAuditavel): ResultadoValidacao {
  // 1. IA propõe, humano decide. Sugestão de modelo jamais nasce confirmada.
  if (a.origem === "IA" && ehPeloMenos(a.confianca, "PROVAVEL")) {
    return {
      valido: false,
      codigo: "IA_NAO_CONFIRMA",
      mensagem:
        "Sugestão de IA não pode nascer como provável ou confirmada. Ela entra como hipótese e só sobe depois da decisão de um operador.",
    }
  }

  // 2. Confirmado exige prova. Sem evidência, no máximo provável.
  if (a.confianca === "CONFIRMADO" && a.evidenciaNecessidadeId == null && a.origem !== "DOCUMENTO") {
    return {
      valido: false,
      codigo: "CONFIRMADO_SEM_EVIDENCIA",
      mensagem:
        "Confirmar exige evidência documental vinculada. Sem documento, o grau máximo é 'provável'.",
    }
  }

  // 3. Afirmação humana precisa de humano responsável.
  const automatica = a.origem === "MOTOR" || a.origem === "IMPORTACAO"
  if (!automatica && a.responsavelId == null) {
    return {
      valido: false,
      codigo: "SEM_RESPONSAVEL",
      mensagem: "Afirmação de origem humana precisa de responsável identificado.",
    }
  }

  // 4. Fora de documento, é preciso dizer por quê.
  if (a.origem !== "DOCUMENTO" && !a.justificativa?.trim()) {
    return {
      valido: false,
      codigo: "SEM_JUSTIFICATIVA",
      mensagem: "Toda afirmação sem documento de base exige justificativa escrita.",
    }
  }

  return { valido: true }
}

/**
 * Valida a PROMOÇÃO de confiança — o momento exato em que uma hipótese vira
 * fato. É aqui que o sistema mais precisa ser rígido.
 */
export function validarPromocao(
  de: GrauConfianca,
  para: GrauConfianca,
  nova: AfirmacaoAuditavel,
): ResultadoValidacao {
  if (PESO[para] <= PESO[de]) return { valido: true } // rebaixar é sempre permitido

  // Sair de CONTESTADO exige resolver a disputa, não apenas reafirmar.
  if (de === "CONTESTADO" && nova.evidenciaNecessidadeId == null) {
    return {
      valido: false,
      codigo: "PROMOCAO_DE_CONTESTADO",
      mensagem:
        "Afirmação contestada só volta a valer com evidência documental — reafirmar sem prova não encerra a divergência.",
    }
  }

  if (para === "CONFIRMADO" && nova.evidenciaNecessidadeId == null) {
    return {
      valido: false,
      codigo: "PROMOCAO_SEM_EVIDENCIA",
      mensagem: "Promover a 'confirmado' exige evidência documental vinculada.",
    }
  }

  return validarAfirmacao(nova)
}

/** Rótulo para a tela — nunca apresentar hipótese com a mesma voz de fato. */
export function descreverAfirmacao(a: AfirmacaoAuditavel): string {
  const base = `${ROTULO_CONFIANCA[a.confianca]} · ${ROTULO_ORIGEM[a.origem]}`
  if (a.confianca === "CONFIRMADO") return base
  return `${base} — não confirmado`
}

/**
 * Campos que NENHUM domínio novo pode duplicar (complemento 1). Pessoa é a
 * única entidade mestre desses dados; os demais domínios referenciam.
 *
 * Exceção única e declarada: `NomePessoa` é o DONO do nome — `Pessoa.nome` e
 * `Pessoa.sobrenome` passam a ser projeção do nome principal. Isso não é cópia,
 * é inversão de fonte, e está previsto na especificação aprovada.
 */
export const CAMPOS_EXCLUSIVOS_DO_MESTRE = [
  "nome",
  "sobrenome",
  "data_nasc",
  "dataNascimento",
  "sexo",
  "nacionalidade",
  "estadoCivil",
  "cpf",
  "rg",
  "paiId",
  "maeId",
] as const
