// src/lib/genealogia/registral/propostas.ts
//
// MRG — construção de PROPOSTAS DE RECONCILIAÇÃO (requisitos 11 e 12). Puro.
//
// Nenhuma alteração registral sensível existe fora de uma proposta. Este módulo
// transforma o resultado da conferência + identidade + integridade em propostas
// com antes, depois e porquê — e classifica cada uma pela matriz de automação.
//
// O que ele NUNCA faz: aplicar. Aplicar é `services/registral/aplicar.ts`, que
// é transacional e revalida. Aqui só se decide O QUE propor e COM QUE nível de
// autorização.

import { criticidadeDaAlteracao, ehCampoCritico, ROTULO_CAMPO } from "./campos"
import { chaveProposta } from "./chaves"
import { valorDoCadastro, valoresCompativeis } from "./integridade"
import type { PessoaEntrada } from "@/src/lib/genealogia/motor/tipos"
import type {
  CampoConferido,
  Correspondencia,
  EvidenciaIdentidade,
  Inconsistencia,
  OcorrenciaExtraida,
  PropostaMontada,
  SeveridadeRegistral,
  TipoPropostaRegistral,
} from "./tipos"

export interface ContextoPropostas {
  processoId: number
  documentoId: number
  /** Pessoa a que o documento se refere (quando já resolvida). */
  pessoaId: number | null
  /** Cadastro atual da pessoa — a origem do "valor atual". */
  pessoa: PessoaEntrada | null
  /** Campos com conflito aberto: propor troca em cima de conflito é escolher lado. */
  camposComConflito: Set<string>
  /** Campos já CONFIRMADOS no cadastro (fatos registrais confirmados). */
  camposConfirmados: Set<string>
  /** Impacto conhecido (preenchido pelo serviço; puro aqui). */
  afetaLinhaCidadania: boolean
  afetaRequerente: boolean
  processosAfetados: number
}

/**
 * Propostas a partir dos CAMPOS conferidos de um documento.
 * Regra central: campo sem valor no cadastro → COMPLETAR (automático quando
 * inequívoco); campo com valor diferente → CORRIGIR (aprovação humana);
 * campo com valor igual → CONFIRMAR (automático, só registra evidência).
 */
export function propostasDeCampos(
  campos: CampoConferido[],
  ctx: ContextoPropostas,
): PropostaMontada[] {
  const out: PropostaMontada[] = []

  for (const c of campos) {
    if (!c.valorNormalizado) continue // DIVERGENTE/AUSENTE não geram proposta de valor
    if (c.papel !== "REGISTRADO") continue // filiação/cônjuge viram proposta de RELAÇÃO
    if (c.campo === "REFERENCIA_REGISTRAL") continue // referência é evidência, não dado da pessoa

    const atual = ctx.pessoa ? valorDoCadastro(ctx.pessoa, c.campo) : null
    const iguais =
      atual != null && valoresCompativeis(c.campo, atual, c.valorNormalizado, c.valorData)

    const favoraveis: EvidenciaIdentidade[] = [
      {
        campo: c.campo,
        descricao: c.explicacao,
        favoravel: true,
        peso: c.veredicto === "CONCORDANTE" ? 3 : c.veredicto === "CONCORDANTE_APOS_NORMALIZACAO" ? 2 : 1,
      },
    ]
    const contrarias: EvidenciaIdentidade[] = []
    if (atual != null && !iguais) {
      contrarias.push({
        campo: c.campo,
        descricao: `O cadastro registra “${atual}” para ${ROTULO_CAMPO[c.campo]}`,
        favoravel: false,
        peso: ctx.camposConfirmados.has(c.campo) ? 4 : 2,
      })
    }

    const tipo: TipoPropostaRegistral = iguais
      ? "CONFIRMAR_DADO"
      : atual == null
        ? "COMPLETAR_DADO"
        : "CORRIGIR_DADO"

    const veredicto = criticidadeDaAlteracao({
      tipo,
      campo: c.campo,
      substituiValorExistente: atual != null && !iguais,
      valorAtualConfirmado: ctx.camposConfirmados.has(c.campo),
      afetaLinhaCidadania: ctx.afetaLinhaCidadania && ehCampoCritico(c.campo),
      afetaRequerente: ctx.afetaRequerente,
      processosAfetados: ctx.processosAfetados,
      existeConflitoAberto: ctx.camposComConflito.has(c.campo),
      alteracaoEmMassa: false,
      irreversivel: false,
    })

    // Confirmação e complemento só entram no modo automático quando a leitura
    // teve conferência real (as duas passagens) ou quando o campo não é crítico.
    const conferido = c.veredicto === "CONCORDANTE" || c.veredicto === "CONCORDANTE_APOS_NORMALIZACAO"
    const automatico =
      veredicto.aplicavelAutomaticamente && (conferido || !ehCampoCritico(c.campo))

    out.push({
      operacao: {
        tipo,
        entidadeAlvo: "PESSOA",
        alvoId: ctx.pessoaId,
        campo: c.campo,
        valorAtual: atual,
        valorProposto: c.valorNormalizado,
        dados: {
          documentoId: ctx.documentoId,
          valorData: c.valorData,
          veredictoConferencia: c.veredicto,
        },
      },
      criticidade: veredicto.criticidade,
      aplicavelAutomaticamente: automatico,
      confianca: c.confianca,
      justificativa: justificativaCampo(tipo, c, atual),
      regraAplicada: `MRG-CAMPO-${tipo}`,
      recomendacao: recomendacaoCampo(tipo, veredicto.criticidade),
      risco: riscoDoCampo(c, atual, ctx),
      evidenciasFavoraveis: favoraveis,
      evidenciasContrarias: contrarias,
      origemValorAtual: atual != null ? "Cadastro da pessoa (Cadastro Mestre)" : null,
      origemValorProposto: `Documento #${ctx.documentoId} — ${c.a?.metodo ?? c.b?.metodo ?? "leitura registral"}`,
      pessoasAfetadas: ctx.pessoaId != null ? [ctx.pessoaId] : [],
      chaveIdempotencia: chaveProposta({
        processoId: ctx.processoId,
        tipo,
        entidadeAlvo: "PESSOA",
        alvoId: ctx.pessoaId,
        campo: c.campo,
        valorProposto: c.valorNormalizado,
      }),
    })
  }

  return out
}

function justificativaCampo(
  tipo: TipoPropostaRegistral,
  c: CampoConferido,
  atual: string | null,
): string {
  const rotulo = ROTULO_CAMPO[c.campo]
  if (tipo === "CONFIRMAR_DADO") {
    return `${rotulo}: o documento confirma o valor já cadastrado (“${atual}”). ${c.explicacao}`
  }
  if (tipo === "COMPLETAR_DADO") {
    return `${rotulo}: o cadastro está vazio e o documento traz “${c.valorNormalizado}”. ${c.explicacao}`
  }
  return `${rotulo}: o documento traz “${c.valorNormalizado}” e o cadastro registra “${atual}”. ${c.explicacao} Substituir dado registral exige decisão humana.`
}

function recomendacaoCampo(tipo: TipoPropostaRegistral, crit: string): string {
  if (tipo === "CONFIRMAR_DADO") return "Registrar a evidência e elevar a confiança do dado."
  if (tipo === "COMPLETAR_DADO") {
    return crit === "AUTOMATICA"
      ? "Preencher o campo vazio com o valor do documento."
      : "Preencher após conferência humana."
  }
  return "Comparar as duas fontes e decidir: corrigir o cadastro, aceitar a variação ou solicitar retificação do documento."
}

function riscoDoCampo(
  c: CampoConferido,
  atual: string | null,
  ctx: ContextoPropostas,
): SeveridadeRegistral {
  if (ctx.afetaLinhaCidadania && ehCampoCritico(c.campo)) return "CRITICO"
  if (atual != null && ctx.camposConfirmados.has(c.campo)) return "ALTO"
  if (ehCampoCritico(c.campo)) return "MEDIO"
  return "BAIXO"
}

// ---------------------------------------------------------------- identidade

export interface ContextoPropostaIdentidade extends ContextoPropostas {
  /** Ocorrência que originou a proposta. */
  ocorrencia: OcorrenciaExtraida
  /** Nome da pessoa proposta (para o texto da proposta). */
  nomeDe: (pessoaId: number) => string
}

/**
 * Propostas a partir do resultado do motor de identidade:
 *   · correspondência forte não confirmada  → VINCULAR_PESSOA_EXISTENTE (aprovação)
 *   · nenhuma correspondência               → CRIAR_PESSOA (aprovação)
 *   · duas correspondências fortes          → nenhuma proposta de vínculo; o
 *                                             conflito de homônimo é o produto
 *   · nome equivalente por variação          → ADICIONAR_NOME_ALTERNATIVO (automático)
 */
export function propostasDeIdentidade(
  correspondencias: Correspondencia[],
  ctx: ContextoPropostaIdentidade,
): PropostaMontada[] {
  const out: PropostaMontada[] = []
  const fortes = correspondencias.filter(
    (c) => c.classe === "CORRESPONDENCIA_CONFIRMADA" || c.classe === "ALTAMENTE_PROVAVEL",
  )
  const conflitantes = correspondencias.filter((c) => c.classe === "REGISTROS_CONFLITANTES")
  const o = ctx.ocorrencia

  // Homônimo: mais de um candidato forte. Nenhuma proposta de vínculo — a
  // decisão precisa de material humano, não de um palpite do motor.
  if (fortes.length > 1) return out

  if (fortes.length === 1) {
    const c = fortes[0]
    const veredicto = criticidadeDaAlteracao({
      tipo: "VINCULAR_PESSOA_EXISTENTE",
      campo: null,
      substituiValorExistente: false,
      valorAtualConfirmado: false,
      afetaLinhaCidadania: ctx.afetaLinhaCidadania,
      afetaRequerente: ctx.afetaRequerente,
      processosAfetados: ctx.processosAfetados,
      existeConflitoAberto: conflitantes.length > 0,
      alteracaoEmMassa: false,
      irreversivel: false,
    })
    out.push({
      operacao: {
        tipo: "VINCULAR_PESSOA_EXISTENTE",
        entidadeAlvo: "PESSOA",
        alvoId: c.pessoaId,
        campo: null,
        valorAtual: null,
        valorProposto: ctx.nomeDe(c.pessoaId),
        dados: {
          documentoId: ctx.documentoId,
          papel: o.papel,
          nomeNoDocumento: o.nomeBruto,
          score: c.score,
          classe: c.classe,
        },
      },
      criticidade: veredicto.criticidade,
      aplicavelAutomaticamente: false,
      confianca: c.score,
      justificativa: `“${o.nomeBruto}” (${o.papel}) no documento #${ctx.documentoId} corresponde a ${ctx.nomeDe(c.pessoaId)} com ${(c.score * 100).toFixed(0)}% de confiança (${c.classe}). Evidências: ${c.evidencias.filter((e) => e.favoravel).map((e) => e.descricao).join("; ") || "nenhuma registrada"}.`,
      regraAplicada: "MRG-IDENT-VINCULAR",
      recomendacao: "Conferir as evidências e confirmar se é a mesma pessoa.",
      risco: ctx.afetaLinhaCidadania ? "ALTO" : "MEDIO",
      evidenciasFavoraveis: c.evidencias.filter((e) => e.favoravel),
      evidenciasContrarias: c.evidencias.filter((e) => !e.favoravel),
      origemValorAtual: null,
      origemValorProposto: `Documento #${ctx.documentoId}, papel ${o.papel}`,
      pessoasAfetadas: [c.pessoaId],
      chaveIdempotencia: chaveProposta({
        processoId: ctx.processoId,
        tipo: "VINCULAR_PESSOA_EXISTENTE",
        entidadeAlvo: "PESSOA",
        alvoId: c.pessoaId,
        campo: null,
        valorProposto: `${ctx.documentoId}:${o.papel}:${o.nomeNormalizado}`,
      }),
    })
    return out
  }

  // Sem correspondência FORTE, a menção não pode ficar sem destino: ou ela é uma
  // pessoa nova, ou o revisor vai ligá-la a um dos candidatos fracos. Propor a
  // criação (com os candidatos possíveis listados como evidência CONTRÁRIA) é o
  // único caminho que não perde a pessoa — deixar sem proposta significa que um
  // ascendente citado na certidão simplesmente desaparece do fluxo.
  {
    out.push({
      operacao: {
        tipo: "CRIAR_PESSOA",
        entidadeAlvo: "PESSOA",
        alvoId: null,
        campo: null,
        valorAtual: null,
        valorProposto: o.nomeNormalizado,
        dados: {
          documentoId: ctx.documentoId,
          papel: o.papel,
          nomeBruto: o.nomeBruto,
          sexoInferido: o.sexoInferido,
          atributos: o.atributos as unknown as Record<string, unknown>,
        },
      },
      criticidade: "APROVACAO_HUMANA",
      aplicavelAutomaticamente: false,
      confianca: 0.6,
      justificativa: correspondencias.length
        ? `“${o.nomeBruto}” aparece no documento #${ctx.documentoId} como ${o.papel}. Nenhum candidato do Cadastro Mestre é inequívoco (${correspondencias.map((c) => `${ctx.nomeDe(c.pessoaId)}: ${(c.score * 100).toFixed(0)}% ${c.classe}`).join("; ")}). Ou é pessoa nova, ou é um destes com grafia diferente — decisão humana.`
        : `“${o.nomeBruto}” aparece no documento #${ctx.documentoId} como ${o.papel} e não corresponde a nenhuma pessoa cadastrada. Criar pessoa é decisão humana — criar sozinho é a forma mais rápida de duplicar identidade.`,
      regraAplicada: "MRG-IDENT-CRIAR",
      recomendacao: "Conferir se a pessoa realmente não existe (inclusive por nome de casada) e então criar.",
      risco: "MEDIO",
      evidenciasFavoraveis: [
        { campo: "documento", descricao: `Menção literal no documento: “${o.nomeBruto}”`, favoravel: true, peso: 2 },
      ],
      evidenciasContrarias: [
        ...correspondencias.flatMap((c) => c.evidencias.filter((e) => !e.favoravel)),
        // Candidato fraco é evidência CONTRÁRIA à criação: pode ser que a pessoa
        // já exista e só a grafia esteja diferente. O revisor decide.
        ...correspondencias
          .filter((c) => c.classe === "POSSIVEL" || c.classe === "REGISTROS_CONFLITANTES")
          .map((c) => ({
            campo: "identidade",
            descricao: `Pode ser ${ctx.nomeDe(c.pessoaId)} (${(c.score * 100).toFixed(0)}%, ${c.classe}) — conferir antes de criar.`,
            favoravel: false,
            peso: 2,
          })),
      ],
      origemValorAtual: null,
      origemValorProposto: `Documento #${ctx.documentoId}, papel ${o.papel}`,
      pessoasAfetadas: [],
      chaveIdempotencia: chaveProposta({
        processoId: ctx.processoId,
        tipo: "CRIAR_PESSOA",
        entidadeAlvo: "PESSOA",
        alvoId: null,
        campo: null,
        valorProposto: `${o.papel}:${o.nomeNormalizado}`,
      }),
    })
  }

  return out
}

/**
 * Proposta de ALIAS: o documento traz uma grafia da mesma pessoa que ainda não
 * está registrada em NomePessoa. Aplicável automaticamente porque acrescentar
 * forma de nome não substitui nem apaga nada — só faz a busca achar.
 */
export function propostaDeAlias(p: {
  processoId: number
  documentoId: number
  pessoaId: number
  nomeNoDocumento: string
  tipoNome: string
  motivo: string
}): PropostaMontada {
  return {
    operacao: {
      tipo: "ADICIONAR_NOME_ALTERNATIVO",
      entidadeAlvo: "PESSOA",
      alvoId: p.pessoaId,
      campo: "NOME_REGISTRAL",
      valorAtual: null,
      valorProposto: p.nomeNoDocumento,
      dados: { documentoId: p.documentoId, tipoNome: p.tipoNome },
    },
    criticidade: "AUTOMATICA",
    aplicavelAutomaticamente: true,
    confianca: 0.9,
    justificativa: `O documento #${p.documentoId} grafa o nome desta pessoa como “${p.nomeNoDocumento}”. ${p.motivo} Registrar a forma alternativa não altera o nome principal e é o que permite localizar a pessoa por essa grafia.`,
    regraAplicada: "MRG-ALIAS-DOCUMENTO",
    recomendacao: "Registrar como forma alternativa (grafia de documento).",
    risco: "BAIXO",
    evidenciasFavoraveis: [
      { campo: "nome", descricao: `Grafia literal no documento: “${p.nomeNoDocumento}”`, favoravel: true, peso: 2 },
    ],
    evidenciasContrarias: [],
    origemValorAtual: "Cadastro da pessoa (nome principal)",
    origemValorProposto: `Documento #${p.documentoId}`,
    pessoasAfetadas: [p.pessoaId],
    chaveIdempotencia: chaveProposta({
      processoId: p.processoId,
      tipo: "ADICIONAR_NOME_ALTERNATIVO",
      entidadeAlvo: "PESSOA",
      alvoId: p.pessoaId,
      campo: "NOME_REGISTRAL",
      valorProposto: p.nomeNoDocumento,
    }),
  }
}

/**
 * Proposta de RELAÇÃO (filiação/união). Criar vínculo é aprovação humana;
 * corrigir ou remover é BLOQUEIO — a matriz decide, não este arquivo.
 */
export function propostaDeRelacao(p: {
  processoId: number
  documentoId: number
  tipo: Extract<TipoPropostaRegistral, "CRIAR_RELACIONAMENTO" | "CORRIGIR_RELACIONAMENTO" | "REMOVER_RELACIONAMENTO">
  filhoId: number
  genitorId: number | null
  genitorAtualId: number | null
  papel: "PAI" | "MAE"
  nomeFilho: string
  nomeGenitor: string
  nomeGenitorAtual: string | null
  confianca: number
  evidencias: EvidenciaIdentidade[]
  afetaLinhaCidadania: boolean
  afetaRequerente: boolean
  processosAfetados: number
}): PropostaMontada {
  const campo = p.papel === "PAI" ? "FILIACAO_PAI" : "FILIACAO_MAE"
  const veredicto = criticidadeDaAlteracao({
    tipo: p.tipo,
    campo,
    substituiValorExistente: p.genitorAtualId != null,
    valorAtualConfirmado: p.genitorAtualId != null,
    afetaLinhaCidadania: p.afetaLinhaCidadania,
    afetaRequerente: p.afetaRequerente,
    processosAfetados: p.processosAfetados,
    existeConflitoAberto: false,
    alteracaoEmMassa: false,
    irreversivel: false,
  })

  return {
    operacao: {
      tipo: p.tipo,
      entidadeAlvo: "PESSOA",
      alvoId: p.filhoId,
      campo,
      valorAtual: p.nomeGenitorAtual,
      valorProposto: p.genitorId != null ? p.nomeGenitor : null,
      dados: {
        documentoId: p.documentoId,
        filhoId: p.filhoId,
        genitorId: p.genitorId,
        genitorAtualId: p.genitorAtualId,
        papel: p.papel,
      },
    },
    criticidade: veredicto.criticidade,
    aplicavelAutomaticamente: false,
    confianca: p.confianca,
    justificativa:
      p.tipo === "CRIAR_RELACIONAMENTO"
        ? `O documento #${p.documentoId} declara que ${p.nomeFilho} é filho(a) de ${p.nomeGenitor} (${p.papel.toLowerCase()}), e esse vínculo não existe no cadastro.`
        : p.tipo === "CORRIGIR_RELACIONAMENTO"
          ? `O documento #${p.documentoId} declara ${p.nomeGenitor} como ${p.papel.toLowerCase()} de ${p.nomeFilho}, mas o cadastro registra ${p.nomeGenitorAtual}. Trocar filiação altera a estrutura da árvore: bloqueado até decisão humana.`
          : `O documento #${p.documentoId} contradiz o vínculo cadastrado entre ${p.nomeFilho} e ${p.nomeGenitorAtual}. Remover vínculo é irreversível na prática: bloqueado.`,
    regraAplicada: `MRG-RELACAO-${p.tipo}`,
    recomendacao: veredicto.motivo,
    risco: p.afetaLinhaCidadania ? "CRITICO" : p.tipo === "CRIAR_RELACIONAMENTO" ? "MEDIO" : "ALTO",
    evidenciasFavoraveis: p.evidencias.filter((e) => e.favoravel),
    evidenciasContrarias: p.evidencias.filter((e) => !e.favoravel),
    origemValorAtual: p.genitorAtualId != null ? "Cadastro da pessoa (filiação atual)" : null,
    origemValorProposto: `Documento #${p.documentoId}`,
    pessoasAfetadas: [p.filhoId, ...(p.genitorId != null ? [p.genitorId] : []), ...(p.genitorAtualId != null ? [p.genitorAtualId] : [])],
    chaveIdempotencia: chaveProposta({
      processoId: p.processoId,
      tipo: p.tipo,
      entidadeAlvo: "PESSOA",
      alvoId: p.filhoId,
      campo,
      valorProposto: String(p.genitorId ?? p.genitorAtualId ?? 0),
    }),
  }
}

/**
 * Proposta a partir de uma INCONSISTÊNCIA de integridade. Toda inconsistência
 * crítica precisa de uma ação proposta — achado sem ação é ruído.
 */
export function propostaDeInconsistencia(p: {
  processoId: number
  inconsistencia: Inconsistencia
}): PropostaMontada | null {
  const i = p.inconsistencia
  // Inconsistência informativa não vira proposta: vira conflito/alerta.
  if (i.severidade === "INFO" || i.severidade === "BAIXO") return null

  const tipo: TipoPropostaRegistral =
    i.codigo === "DIVERGENCIA_ARVORE_CERTIDAO"
      ? "MARCAR_DOCUMENTO_DIVERGENTE"
      : i.codigo === "REQUERENTE_DUPLICADO"
        ? "MESCLAR_PESSOAS"
        : i.codigo === "VINCULO_DUPLICADO"
          ? "REMOVER_RELACIONAMENTO"
          : i.codigo === "FILIACAO_CONTRADITORIA" || i.codigo === "CICLO_GENEALOGICO" || i.codigo === "PESSOA_ANCESTRAL_DE_SI"
            ? "CORRIGIR_RELACIONAMENTO"
            : "SOLICITAR_RETIFICACAO"

  const veredicto = criticidadeDaAlteracao({
    tipo,
    campo: i.campo ?? null,
    substituiValorExistente: true,
    valorAtualConfirmado: true,
    afetaLinhaCidadania: i.severidade === "CRITICO",
    afetaRequerente: i.codigo === "REQUERENTE_DUPLICADO",
    processosAfetados: 1,
    existeConflitoAberto: true,
    alteracaoEmMassa: false,
    irreversivel: tipo === "MESCLAR_PESSOAS",
  })

  return {
    operacao: {
      tipo,
      entidadeAlvo: "PESSOA",
      alvoId: i.pessoaIds[0] ?? null,
      campo: i.campo ?? null,
      valorAtual: null,
      valorProposto: null,
      dados: {
        codigoInconsistencia: i.codigo,
        pessoaIds: i.pessoaIds,
        uniaoIds: i.uniaoIds ?? [],
      },
    },
    criticidade: veredicto.criticidade,
    aplicavelAutomaticamente: false,
    confianca: 0.7,
    justificativa: `${i.descricao}. ${i.explicacao}`,
    regraAplicada: `MRG-INTEGRIDADE-${i.codigo}`,
    recomendacao: i.acaoSugerida,
    risco: i.severidade,
    evidenciasFavoraveis: i.evidencias.map((e) => ({
      campo: i.campo ?? i.codigo,
      descricao: e,
      favoravel: true,
      peso: 1,
    })),
    evidenciasContrarias: [],
    origemValorAtual: "Motor de integridade genealógica",
    origemValorProposto: null,
    pessoasAfetadas: i.pessoaIds,
    chaveIdempotencia: chaveProposta({
      processoId: p.processoId,
      tipo,
      entidadeAlvo: "PESSOA",
      alvoId: i.pessoaIds[0] ?? null,
      campo: i.campo ?? null,
      valorProposto: i.codigo,
    }),
  }
}
