// src/lib/genealogia/registral/campos.ts
//
// MRG — catálogo dos campos registrais e a MATRIZ DE AUTOMAÇÃO (requisito 12).
//
// Este arquivo é a lei do motor: define quais campos são críticos (e portanto
// exigem extração dupla e revalidação antes de virar fato) e o que o sistema
// pode aplicar sozinho, o que exige assinatura humana e o que é proibido.
//
// Módulo PURO e ÚNICO. Nenhum outro lugar do Discovery redefine criticidade nem
// nível de autorização registral — matriz duplicada é como a mesma correção
// passa sozinha por um caminho e é bloqueada pelo outro.

import type {
  CampoRegistral,
  CriticidadeRegistral,
  TipoPropostaRegistral,
} from "./tipos"

export const ROTULO_CAMPO: Record<CampoRegistral, string> = {
  NOME_REGISTRAL: "Nome de registro",
  NOME_CASADO: "Nome de casado(a)",
  SEXO: "Sexo",
  DATA_NASCIMENTO: "Data de nascimento",
  LOCAL_NASCIMENTO: "Local de nascimento",
  PAIS_NASCIMENTO: "País de nascimento",
  FILIACAO_PAI: "Filiação — pai",
  FILIACAO_MAE: "Filiação — mãe",
  DATA_CASAMENTO: "Data do casamento",
  LOCAL_CASAMENTO: "Local do casamento",
  CONJUGE: "Cônjuge",
  DATA_OBITO: "Data do óbito",
  LOCAL_OBITO: "Local do óbito",
  DATA_BATISMO: "Data do batismo",
  LOCAL_BATISMO: "Local do batismo",
  PROFISSAO: "Profissão",
  NACIONALIDADE: "Nacionalidade",
  NATURALIZACAO: "Naturalização",
  IDADE_DECLARADA: "Idade declarada",
  RESIDENCIA_HISTORICA: "Residência histórica",
  REFERENCIA_REGISTRAL: "Referência registral (cartório/livro/folha/termo)",
  DATA_EMIGRACAO: "Data de emigração",
  IDENTIDADE_PESSOA: "Identidade da pessoa",
  IDENTIDADE_PAI: "Identidade do pai",
  IDENTIDADE_MAE: "Identidade da mãe",
  VINCULO_ASCENDENTE_TRANSMISSOR: "Vínculo com o ascendente transmissor",
}

/**
 * CAMPOS CRÍTICOS (requisito 3 do escopo e 7 do protocolo).
 * Uma única leitura nunca basta: precisam de extração inicial + extração
 * independente de conferência + comparação + validação + cruzamento +
 * revalidação. Divergência entre leituras BLOQUEIA, nunca escolhe a de maior
 * confiança.
 */
export const CAMPOS_CRITICOS: ReadonlySet<CampoRegistral> = new Set<CampoRegistral>([
  "NOME_REGISTRAL",
  "FILIACAO_PAI",
  "FILIACAO_MAE",
  "DATA_NASCIMENTO",
  "LOCAL_NASCIMENTO",
  "DATA_CASAMENTO",
  "DATA_OBITO",
  "IDENTIDADE_PESSOA",
  "IDENTIDADE_PAI",
  "IDENTIDADE_MAE",
  "VINCULO_ASCENDENTE_TRANSMISSOR",
])

export function ehCampoCritico(campo: CampoRegistral): boolean {
  return CAMPOS_CRITICOS.has(campo)
}

/** Campos temporais — o normalizador tem de resolver data para eles. */
export const CAMPOS_DATA: ReadonlySet<CampoRegistral> = new Set<CampoRegistral>([
  "DATA_NASCIMENTO",
  "DATA_CASAMENTO",
  "DATA_OBITO",
  "DATA_BATISMO",
  "DATA_EMIGRACAO",
  "NATURALIZACAO",
])

/** Campos que carregam nome de pessoa (comparação fonética, não textual). */
export const CAMPOS_NOME: ReadonlySet<CampoRegistral> = new Set<CampoRegistral>([
  "NOME_REGISTRAL",
  "NOME_CASADO",
  "FILIACAO_PAI",
  "FILIACAO_MAE",
  "CONJUGE",
])

/** Campos de localidade (comparação tolerante a sufixo/comune). */
export const CAMPOS_LOCAL: ReadonlySet<CampoRegistral> = new Set<CampoRegistral>([
  "LOCAL_NASCIMENTO",
  "PAIS_NASCIMENTO",
  "LOCAL_CASAMENTO",
  "LOCAL_OBITO",
  "LOCAL_BATISMO",
  "RESIDENCIA_HISTORICA",
])

// ============================================================================
// MATRIZ DE AUTOMAÇÃO E BLOQUEIO (requisito 12)
// ============================================================================

/**
 * Campos que EXIGEM aprovação humana quando o motor quer substituir um valor
 * que já existe. Preencher lacuna é diferente de corrigir dado — a distinção
 * está em `criticidadeDaAlteracao`.
 */
const CAMPOS_APROVACAO_HUMANA: ReadonlySet<CampoRegistral> = new Set<CampoRegistral>([
  "NOME_REGISTRAL",
  "DATA_NASCIMENTO",
  "LOCAL_NASCIMENTO",
  "FILIACAO_PAI",
  "FILIACAO_MAE",
  "DATA_CASAMENTO",
  "DATA_OBITO",
  "IDENTIDADE_PESSOA",
  "IDENTIDADE_PAI",
  "IDENTIDADE_MAE",
])

/**
 * Tipos de proposta com BLOQUEIO obrigatório: nunca aplicáveis sem decisão
 * humana explícita, e cada um exige a sua permissão dedicada.
 */
export const TIPOS_BLOQUEADOS: ReadonlySet<TipoPropostaRegistral> = new Set<TipoPropostaRegistral>([
  "MESCLAR_PESSOAS",
  "SEPARAR_PESSOAS",
  "REMOVER_RELACIONAMENTO",
  "CORRIGIR_RELACIONAMENTO",
  "SOLICITAR_RETIFICACAO",
])

/** Tipos que sempre exigem aprovação humana (mas não são bloqueio). */
const TIPOS_APROVACAO: ReadonlySet<TipoPropostaRegistral> = new Set<TipoPropostaRegistral>([
  "CORRIGIR_DADO",
  "CRIAR_PESSOA",
  "VINCULAR_PESSOA_EXISTENTE",
  "CRIAR_RELACIONAMENTO",
  "MARCAR_DOCUMENTO_DIVERGENTE",
  "REABRIR_NECESSIDADE",
])

/**
 * Tipos que o motor PODE aplicar sozinho — e somente quando inequívocos:
 * registrar evidência, registrar confiança, completar lacuna sem conflito,
 * satisfazer necessidade claramente atendida, criar alerta/proposta.
 */
const TIPOS_AUTOMATICOS: ReadonlySet<TipoPropostaRegistral> = new Set<TipoPropostaRegistral>([
  "CONFIRMAR_DADO",
  "COMPLETAR_DADO",
  "ADICIONAR_NOME_ALTERNATIVO",
  "SATISFAZER_NECESSIDADE",
  "CRIAR_NECESSIDADE",
])

export interface ContextoAlteracao {
  tipo: TipoPropostaRegistral
  campo?: CampoRegistral | null
  /** Existe valor atual diferente do proposto? (substituição, não preenchimento) */
  substituiValorExistente: boolean
  /** O valor atual já estava CONFIRMADO? Substituir confirmado sempre sobe. */
  valorAtualConfirmado: boolean
  /** A alteração muda a linha de cidadania / o ascendente transmissor? */
  afetaLinhaCidadania: boolean
  /** A alteração toca vínculo usado por requerente? */
  afetaRequerente: boolean
  /** Mais de um processo é impactado? */
  processosAfetados: number
  /** Há divergência/conflito aberto sobre o mesmo campo? */
  existeConflitoAberto: boolean
  /** Operação em massa (lote de alterações num único ato). */
  alteracaoEmMassa: boolean
  /** A operação é irreversível por natureza. */
  irreversivel: boolean
}

export interface VeredictoAutomacao {
  criticidade: CriticidadeRegistral
  aplicavelAutomaticamente: boolean
  /** Permissão exigida para decidir. */
  permissao: PermissaoRegistral
  motivo: string
}

export type PermissaoRegistral =
  | "registral.ver_evidencias"
  | "registral.revisar"
  | "registral.aprovar"
  | "registral.alterar_filiacao"
  | "registral.mesclar_pessoas"
  | "registral.reverter"
  | "registral.reprocessar"
  | "registral.administrar_regras"

/**
 * Decide o nível de autorização de UMA alteração. É o portão único: o aplicador
 * chama isto antes de tocar em qualquer coisa, e a API chama isto para exigir a
 * permissão certa. Ordem das regras importa — bloqueio vence tudo.
 */
export function criticidadeDaAlteracao(ctx: ContextoAlteracao): VeredictoAutomacao {
  // 1. BLOQUEIO — irreversível, em massa, ou tipo estruturalmente perigoso.
  if (ctx.irreversivel) {
    return bloqueio("Operação irreversível: exige decisão humana explícita e registrada.", ctx)
  }
  if (ctx.alteracaoEmMassa) {
    return bloqueio("Alteração em massa: proibida sem decisão humana por item.", ctx)
  }
  if (ctx.tipo === "MESCLAR_PESSOAS" || ctx.tipo === "SEPARAR_PESSOAS") {
    return {
      criticidade: "BLOQUEIO",
      aplicavelAutomaticamente: false,
      permissao: "registral.mesclar_pessoas",
      motivo:
        "Fusão e separação de identidade humana são bloqueadas: exigem análise de impacto, permissão dedicada e reversão possível.",
    }
  }
  if (ctx.tipo === "REMOVER_RELACIONAMENTO" || ctx.tipo === "CORRIGIR_RELACIONAMENTO") {
    return {
      criticidade: "BLOQUEIO",
      aplicavelAutomaticamente: false,
      permissao: "registral.alterar_filiacao",
      motivo:
        "Trocar ou remover filiação altera a estrutura da árvore e pode derrubar a linha de transmissão.",
    }
  }
  if (ctx.afetaLinhaCidadania) {
    return bloqueio(
      "A alteração muda a linha de cidadania ou o ascendente transmissor.",
      ctx,
      "registral.alterar_filiacao",
    )
  }
  if (ctx.afetaRequerente && ctx.substituiValorExistente) {
    return bloqueio(
      "O vínculo alterado é usado por um requerente: mudar sem revisão afeta o processo dele.",
      ctx,
      "registral.alterar_filiacao",
    )
  }
  if (ctx.processosAfetados > 1) {
    return bloqueio(
      `A alteração impacta ${ctx.processosAfetados} processos — decisão humana obrigatória.`,
      ctx,
    )
  }
  if (TIPOS_BLOQUEADOS.has(ctx.tipo)) {
    return bloqueio("Tipo de alteração classificado como bloqueio pela matriz.", ctx)
  }

  // 2. APROVAÇÃO HUMANA — substituição de dado registral sensível ou confirmado.
  if (ctx.valorAtualConfirmado && ctx.substituiValorExistente) {
    return aprovacao(
      "Substituir um dado já confirmado exige assinatura humana, mesmo com evidência nova.",
    )
  }
  if (ctx.existeConflitoAberto) {
    return aprovacao("Existe divergência aberta sobre este campo: aplicar sozinho seria escolher lado.")
  }
  if (ctx.campo && CAMPOS_APROVACAO_HUMANA.has(ctx.campo) && ctx.substituiValorExistente) {
    return aprovacao(
      `${ROTULO_CAMPO[ctx.campo]} é dado registral sensível: alterar valor existente exige aprovação.`,
    )
  }
  if (TIPOS_APROVACAO.has(ctx.tipo)) {
    return aprovacao("Tipo de alteração que a matriz classifica como aprovação humana.")
  }

  // 3. AUTOMÁTICA — só o inequívoco.
  if (TIPOS_AUTOMATICOS.has(ctx.tipo) && !ctx.substituiValorExistente) {
    return {
      criticidade: "AUTOMATICA",
      aplicavelAutomaticamente: true,
      permissao: "registral.revisar",
      motivo:
        "Preenchimento de lacuna sem conflito, sem impacto estrutural e sem substituição de dado — aplicável pelo motor.",
    }
  }

  // Default conservador: na dúvida, humano decide.
  return aprovacao("Fora da lista de operações inequívocas: por padrão o motor não aplica sozinho.")
}

function bloqueio(
  motivo: string,
  ctx: ContextoAlteracao,
  permissao: PermissaoRegistral = "registral.aprovar",
): VeredictoAutomacao {
  return {
    criticidade: "BLOQUEIO",
    aplicavelAutomaticamente: false,
    permissao:
      ctx.tipo === "MESCLAR_PESSOAS" || ctx.tipo === "SEPARAR_PESSOAS"
        ? "registral.mesclar_pessoas"
        : permissao,
    motivo,
  }
}

function aprovacao(motivo: string): VeredictoAutomacao {
  return {
    criticidade: "APROVACAO_HUMANA",
    aplicavelAutomaticamente: false,
    permissao: "registral.aprovar",
    motivo,
  }
}

/** Permissão exigida para aplicar/decidir uma proposta já classificada. */
export function permissaoDaProposta(
  tipo: TipoPropostaRegistral,
  criticidade: CriticidadeRegistral,
): PermissaoRegistral {
  if (tipo === "MESCLAR_PESSOAS" || tipo === "SEPARAR_PESSOAS") return "registral.mesclar_pessoas"
  if (
    tipo === "REMOVER_RELACIONAMENTO" ||
    tipo === "CORRIGIR_RELACIONAMENTO" ||
    tipo === "CRIAR_RELACIONAMENTO"
  ) {
    return "registral.alterar_filiacao"
  }
  if (criticidade === "AUTOMATICA") return "registral.revisar"
  return "registral.aprovar"
}

/**
 * Estado do fato a partir das evidências acumuladas (requisito 7 do escopo).
 * Nunca existe "um status genérico da pessoa": este cálculo é por campo.
 */
export function estadoDoFato(params: {
  temValor: boolean
  favoraveis: number
  contrarias: number
  divergenciaEntreLeituras: boolean
  conflitoAberto: boolean
  emRevisao: boolean
  rejeitado: boolean
  informadoPeloCliente: boolean
  incompleto: boolean
}): import("./tipos").EstadoFatoRegistral {
  if (params.rejeitado) return "REJEITADO"
  if (params.emRevisao) return "EM_REVISAO"
  if (params.conflitoAberto) return "CONFLITANTE"
  if (params.divergenciaEntreLeituras) return "DIVERGENTE"
  if (!params.temValor) return params.informadoPeloCliente ? "INFORMADO_PELO_CLIENTE" : "NAO_INFORMADO"
  if (params.incompleto) return "INCOMPLETO"
  if (params.favoraveis >= 2 && params.contrarias === 0) return "CONFIRMADO_MULTIPLAS_EVIDENCIAS"
  if (params.favoraveis === 1 && params.contrarias === 0) return "CONFIRMADO"
  if (params.favoraveis === 0 && params.contrarias === 0) {
    return params.informadoPeloCliente ? "INFORMADO_PELO_CLIENTE" : "NAO_COMPROVADO"
  }
  // Há evidência dos dois lados sem conflito formalizado: probabilístico.
  return params.favoraveis > params.contrarias ? "PROVAVEL" : "DIVERGENTE"
}

/** Confiança (escala do Discovery) derivada do estado do fato. */
export function confiancaDoEstado(
  estado: import("./tipos").EstadoFatoRegistral,
): import("@/src/lib/cadastro-mestre/afirmacao").GrauConfianca {
  switch (estado) {
    case "CONFIRMADO":
    case "CONFIRMADO_MULTIPLAS_EVIDENCIAS":
      return "CONFIRMADO"
    case "PROVAVEL":
      return "PROVAVEL"
    case "DIVERGENTE":
    case "CONFLITANTE":
    case "EM_REVISAO":
    case "REJEITADO":
      return "CONTESTADO"
    default:
      return "HIPOTESE"
  }
}
