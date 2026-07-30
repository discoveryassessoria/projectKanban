/**
 * MRG — MATRIZ DE AUTOMAÇÃO, estado do fato, IMPACTO, REVALIDAÇÃO, VERSÃO,
 * PROPOSTAS, CHAVES DE IDEMPOTÊNCIA, MÉTRICAS e COPILOTO.
 * Rodar: npx tsx scripts/mrg-decisao.test.ts
 *
 * O que este arquivo protege:
 *  · o que o motor pode aplicar sozinho, o que exige assinatura e o que é
 *    BLOQUEIO — e que a fronteira não se mova por refatoração;
 *  · a revalidação pós-aplicação com as DEZ verificações do escopo;
 *  · snapshot determinístico (sem ele não existe reversão confiável);
 *  · reversão NUNCA exclui pessoa;
 *  · chave de idempotência determinística e dentro do limite da coluna;
 *  · log sem conteúdo sensível integral;
 *  · copiloto não inventa: sem dado, responde "sem dado".
 */
import {
  criticidadeDaAlteracao,
  confiancaDoEstado,
  estadoDoFato,
  ehCampoCritico,
  permissaoDaProposta,
  CAMPOS_CRITICOS,
  TIPOS_BLOQUEADOS,
} from "../src/lib/genealogia/registral/campos"
import { analisarImpacto, fotografar, revalidar } from "../src/lib/genealogia/registral/impacto"
import {
  compararSnapshots,
  hashDoSnapshot,
  montarSnapshot,
  planejarReversao,
  serializarCanonico,
} from "../src/lib/genealogia/registral/versao"
import {
  chaveConflito,
  chaveDecisao,
  chaveEvidencia,
  chaveExecucao,
  chaveFato,
  chaveLote,
  chaveOcorrencia,
  chaveProposta,
  correlationId,
  hashEstavel,
} from "../src/lib/genealogia/registral/chaves"
import { propostasDeCampos, propostaDeAlias, propostaDeInconsistencia, propostaDeRelacao } from "../src/lib/genealogia/registral/propostas"
import { CAMPOS_SENSIVEIS, METRICAS, janelaDe, metricasDoLote, redigirParaLog, reduzir } from "../src/lib/genealogia/registral/metricas"
import { classificarPergunta, responder, severidadeDoDossie, type DossieCopiloto } from "../src/lib/genealogia/registral/copiloto"
import type { CampoConferido, CampoRegistral, Inconsistencia, ResultadoElegibilidade } from "../src/lib/genealogia/registral/tipos"
import type { PessoaEntrada } from "../src/lib/genealogia/motor/tipos"

let passed = 0
let failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string, detalhe?: unknown) {
  if (cond) {
    passed++
    console.log(`  ✅ ${nome}`)
  } else {
    failed++
    falhas.push(nome)
    console.log(`  ❌ ${nome}${detalhe !== undefined ? ` → ${JSON.stringify(detalhe)}` : ""}`)
  }
}

const ctxBase = {
  substituiValorExistente: false,
  valorAtualConfirmado: false,
  afetaLinhaCidadania: false,
  afetaRequerente: false,
  processosAfetados: 1,
  existeConflitoAberto: false,
  alteracaoEmMassa: false,
  irreversivel: false,
}

// ============================================================
console.log("\n1) MATRIZ — o que o motor pode aplicar sozinho")
const automatica = criticidadeDaAlteracao({ ...ctxBase, tipo: "COMPLETAR_DADO", campo: "PROFISSAO" })
ok(automatica.criticidade === "AUTOMATICA", "preencher lacuna sem conflito é automático", automatica)
ok(automatica.aplicavelAutomaticamente === true, "e aplicável pelo motor")

const confirmar = criticidadeDaAlteracao({ ...ctxBase, tipo: "CONFIRMAR_DADO", campo: "DATA_NASCIMENTO" })
ok(confirmar.criticidade === "AUTOMATICA", "confirmar dado existente é automático (não altera valor)")

const alias = criticidadeDaAlteracao({ ...ctxBase, tipo: "ADICIONAR_NOME_ALTERNATIVO", campo: "NOME_REGISTRAL" })
ok(alias.criticidade === "AUTOMATICA", "acrescentar forma de nome é automático (nada é substituído)")

console.log("\n2) MATRIZ — o que exige assinatura humana")
for (const campo of ["NOME_REGISTRAL", "DATA_NASCIMENTO", "LOCAL_NASCIMENTO", "DATA_OBITO"] as CampoRegistral[]) {
  const v = criticidadeDaAlteracao({ ...ctxBase, tipo: "CORRIGIR_DADO", campo, substituiValorExistente: true })
  ok(v.criticidade === "APROVACAO_HUMANA", `substituir ${campo} exige aprovação`, v.criticidade)
  ok(v.aplicavelAutomaticamente === false, `${campo}: motor não aplica`)
}
const substituirConfirmado = criticidadeDaAlteracao({
  ...ctxBase,
  tipo: "COMPLETAR_DADO",
  campo: "PROFISSAO",
  substituiValorExistente: true,
  valorAtualConfirmado: true,
})
ok(substituirConfirmado.criticidade === "APROVACAO_HUMANA", "substituir dado CONFIRMADO sempre sobe de nível")

const comConflito = criticidadeDaAlteracao({ ...ctxBase, tipo: "COMPLETAR_DADO", campo: "PROFISSAO", existeConflitoAberto: true })
ok(comConflito.criticidade === "APROVACAO_HUMANA", "com conflito aberto, aplicar sozinho seria escolher lado")

console.log("\n3) MATRIZ — BLOQUEIO obrigatório")
const fusao = criticidadeDaAlteracao({ ...ctxBase, tipo: "MESCLAR_PESSOAS" })
ok(fusao.criticidade === "BLOQUEIO", "fusão de pessoas é bloqueio")
ok(fusao.permissao === "registral.mesclar_pessoas", "com permissão dedicada", fusao.permissao)

const separar = criticidadeDaAlteracao({ ...ctxBase, tipo: "SEPARAR_PESSOAS" })
ok(separar.criticidade === "BLOQUEIO", "separação também é bloqueio")

const trocaFiliacao = criticidadeDaAlteracao({ ...ctxBase, tipo: "CORRIGIR_RELACIONAMENTO", campo: "FILIACAO_PAI" })
ok(trocaFiliacao.criticidade === "BLOQUEIO", "trocar filiação é bloqueio")
ok(trocaFiliacao.permissao === "registral.alterar_filiacao", "com permissão de filiação")

const remover = criticidadeDaAlteracao({ ...ctxBase, tipo: "REMOVER_RELACIONAMENTO" })
ok(remover.criticidade === "BLOQUEIO", "remover vínculo é bloqueio")

const mudaLinha = criticidadeDaAlteracao({ ...ctxBase, tipo: "COMPLETAR_DADO", campo: "DATA_NASCIMENTO", afetaLinhaCidadania: true })
ok(mudaLinha.criticidade === "BLOQUEIO", "alteração que muda a linha de cidadania é bloqueio")

const massa = criticidadeDaAlteracao({ ...ctxBase, tipo: "CONFIRMAR_DADO", alteracaoEmMassa: true })
ok(massa.criticidade === "BLOQUEIO", "alteração em massa é bloqueio")

const irreversivel = criticidadeDaAlteracao({ ...ctxBase, tipo: "CONFIRMAR_DADO", irreversivel: true })
ok(irreversivel.criticidade === "BLOQUEIO", "operação irreversível é bloqueio")

const multiProcesso = criticidadeDaAlteracao({ ...ctxBase, tipo: "CONFIRMAR_DADO", processosAfetados: 3 })
ok(multiProcesso.criticidade === "BLOQUEIO", "impacto em vários processos é bloqueio")

const requerente = criticidadeDaAlteracao({
  ...ctxBase,
  tipo: "CORRIGIR_DADO",
  campo: "NOME_REGISTRAL",
  substituiValorExistente: true,
  afetaRequerente: true,
})
ok(requerente.criticidade === "BLOQUEIO", "vínculo usado por requerente é bloqueio")

console.log("\n4) MATRIZ — default conservador e coerência do catálogo")
const desconhecido = criticidadeDaAlteracao({ ...ctxBase, tipo: "SOLICITAR_RETIFICACAO" })
ok(desconhecido.criticidade === "BLOQUEIO", "tipo da lista de bloqueados permanece bloqueio")
ok(TIPOS_BLOQUEADOS.has("MESCLAR_PESSOAS"), "catálogo de bloqueados inclui fusão")
ok(CAMPOS_CRITICOS.has("FILIACAO_PAI") && CAMPOS_CRITICOS.has("NOME_REGISTRAL"), "campos críticos declarados")
ok(!ehCampoCritico("PROFISSAO"), "profissão não é campo crítico")
ok(permissaoDaProposta("MESCLAR_PESSOAS", "BLOQUEIO") === "registral.mesclar_pessoas", "permissão de fusão")
ok(permissaoDaProposta("CRIAR_RELACIONAMENTO", "APROVACAO_HUMANA") === "registral.alterar_filiacao", "permissão de relação")
ok(permissaoDaProposta("CONFIRMAR_DADO", "AUTOMATICA") === "registral.revisar", "permissão de revisão")

console.log("\n5) ESTADO DO FATO — um estado por campo, nunca um status por pessoa")
const base = {
  temValor: true,
  favoraveis: 0,
  contrarias: 0,
  divergenciaEntreLeituras: false,
  conflitoAberto: false,
  emRevisao: false,
  rejeitado: false,
  informadoPeloCliente: false,
  incompleto: false,
}
ok(estadoDoFato({ ...base, temValor: false }) === "NAO_INFORMADO", "sem valor → NAO_INFORMADO")
ok(estadoDoFato({ ...base, temValor: false, informadoPeloCliente: true }) === "INFORMADO_PELO_CLIENTE", "declarado pelo cliente")
ok(estadoDoFato({ ...base, favoraveis: 1 }) === "CONFIRMADO", "1 evidência → CONFIRMADO")
ok(estadoDoFato({ ...base, favoraveis: 2 }) === "CONFIRMADO_MULTIPLAS_EVIDENCIAS", "2 evidências → múltiplas")
ok(estadoDoFato({ ...base }) === "NAO_COMPROVADO", "valor sem evidência → NAO_COMPROVADO")
ok(estadoDoFato({ ...base, divergenciaEntreLeituras: true }) === "DIVERGENTE", "divergência entre leituras → DIVERGENTE")
ok(estadoDoFato({ ...base, conflitoAberto: true }) === "CONFLITANTE", "conflito → CONFLITANTE")
ok(estadoDoFato({ ...base, emRevisao: true }) === "EM_REVISAO", "em revisão")
ok(estadoDoFato({ ...base, rejeitado: true }) === "REJEITADO", "rejeitado")
ok(estadoDoFato({ ...base, incompleto: true }) === "INCOMPLETO", "incompleto")
ok(estadoDoFato({ ...base, favoraveis: 3, contrarias: 1 }) === "PROVAVEL", "mais a favor que contra → PROVAVEL")
ok(estadoDoFato({ ...base, favoraveis: 1, contrarias: 3 }) === "DIVERGENTE", "mais contra que a favor → DIVERGENTE")

ok(confiancaDoEstado("CONFIRMADO") === "CONFIRMADO", "confiança de confirmado")
ok(confiancaDoEstado("DIVERGENTE") === "CONTESTADO", "divergente é CONTESTADO")
ok(confiancaDoEstado("EXTRAIDO") === "HIPOTESE", "extraído sem prova é HIPÓTESE")

// ============================================================
console.log("\n6) PROPOSTAS a partir dos campos conferidos")
const pessoa: PessoaEntrada = { id: 5, nome: "Joao", sobrenome: "Silva", data_nasc: "1901-03-12" }
function conferido(p: Partial<CampoConferido> & { campo: CampoRegistral; valor: string | null }): CampoConferido {
  return {
    campo: p.campo,
    papel: p.papel ?? "REGISTRADO",
    veredicto: p.veredicto ?? "CONCORDANTE",
    a: null,
    b: null,
    valorNormalizado: p.valor,
    valorData: p.valorData ?? null,
    confianca: p.confianca ?? 0.95,
    bloqueadoParaRevisao: p.bloqueadoParaRevisao ?? false,
    explicacao: p.explicacao ?? "as duas leituras concordam",
  }
}
const ctxProp = {
  processoId: 1,
  documentoId: 9,
  pessoaId: 5,
  pessoa,
  camposComConflito: new Set<string>(),
  camposConfirmados: new Set<string>(),
  afetaLinhaCidadania: false,
  afetaRequerente: false,
  processosAfetados: 1,
}

const props = propostasDeCampos(
  [
    conferido({ campo: "DATA_NASCIMENTO", valor: "1901-03-12", valorData: "1901-03-12" }),
    conferido({ campo: "PROFISSAO", valor: "LAVRADOR" }),
    conferido({ campo: "LOCAL_NASCIMENTO", valor: "VERONA" }),
    conferido({ campo: "FILIACAO_PAI", valor: null, veredicto: "DIVERGENTE", bloqueadoParaRevisao: true }),
  ],
  ctxProp,
)
const confirmarData = props.find((p) => p.operacao.campo === "DATA_NASCIMENTO")
ok(confirmarData?.operacao.tipo === "CONFIRMAR_DADO", "valor igual ao cadastro → CONFIRMAR", confirmarData?.operacao.tipo)
const completarProf = props.find((p) => p.operacao.campo === "PROFISSAO")
ok(completarProf?.operacao.tipo === "COMPLETAR_DADO", "campo vazio → COMPLETAR", completarProf?.operacao.tipo)
ok(completarProf?.aplicavelAutomaticamente === true, "e é aplicável automaticamente")
ok(!props.some((p) => p.operacao.campo === "FILIACAO_PAI"), "campo DIVERGENTE não gera proposta de valor")

const ctxComValor = { ...ctxProp, pessoa: { ...pessoa, profissao: "COMERCIANTE" } }
const propsCorrigir = propostasDeCampos([conferido({ campo: "PROFISSAO", valor: "LAVRADOR" })], ctxComValor)
ok(propsCorrigir[0]?.operacao.tipo === "CORRIGIR_DADO", "valor diferente do cadastro → CORRIGIR")
ok(propsCorrigir[0]?.aplicavelAutomaticamente === false, "corrigir NUNCA é automático")
ok(propsCorrigir[0]?.evidenciasContrarias.length === 1, "e registra a evidência contrária (o valor atual)")
ok(propsCorrigir[0]?.origemValorAtual?.includes("Cadastro") === true, "com a origem do valor atual")
ok(propsCorrigir[0]?.origemValorProposto?.includes("Documento") === true, "e a origem do valor proposto")

const propAlias = propostaDeAlias({
  processoId: 1,
  documentoId: 9,
  pessoaId: 5,
  nomeNoDocumento: "JOAO SYLVA",
  tipoNome: "GRAFIA_DOCUMENTO",
  motivo: "grafia nova",
})
ok(propAlias.aplicavelAutomaticamente === true, "alias é aplicável automaticamente")
ok(propAlias.criticidade === "AUTOMATICA", "e classificado como automático")

const propRel = propostaDeRelacao({
  processoId: 1,
  documentoId: 9,
  tipo: "CRIAR_RELACIONAMENTO",
  filhoId: 5,
  genitorId: 6,
  genitorAtualId: null,
  papel: "PAI",
  nomeFilho: "Joao",
  nomeGenitor: "Giuseppe",
  nomeGenitorAtual: null,
  confianca: 0.85,
  evidencias: [],
  afetaLinhaCidadania: false,
  afetaRequerente: false,
  processosAfetados: 1,
})
ok(propRel.aplicavelAutomaticamente === false, "criar vínculo nunca é automático")
ok(propRel.criticidade === "BLOQUEIO" || propRel.criticidade === "APROVACAO_HUMANA", "e exige decisão", propRel.criticidade)

const inc: Inconsistencia = {
  codigo: "REQUERENTE_DUPLICADO",
  severidade: "ALTO",
  pessoaIds: [1, 2],
  descricao: "dois requerentes iguais",
  explicacao: "x",
  acaoSugerida: "y",
  evidencias: ["similaridade=0.99"],
}
const propInc = propostaDeInconsistencia({ processoId: 1, inconsistencia: inc })
ok(propInc?.operacao.tipo === "MESCLAR_PESSOAS", "requerente duplicado propõe fusão", propInc?.operacao.tipo)
ok(propInc?.criticidade === "BLOQUEIO", "e é bloqueio")
ok(propostaDeInconsistencia({ processoId: 1, inconsistencia: { ...inc, severidade: "INFO" } }) === null, "achado informativo não vira proposta")

// ============================================================
console.log("\n7) IMPACTO e as DEZ verificações da revalidação")
function estado(pessoas: PessoaEntrada[], comprovacao: Map<number, Set<CampoRegistral>> = new Map()) {
  return {
    integridade: { pessoas, unioes: [], requerenteIds: [1], fatos: [] },
    elegibilidade: {
      pessoas,
      unioes: [],
      paisAlvo: "ITALIA" as const,
      requerenteId: 1,
      raizId: 1,
      comprovacaoPorPessoa: comprovacao,
    },
  }
}
const sadio = [
  { id: 1, nome: "Req", requerente: "sim", paiId: 2, data_nasc: "1990-01-01" },
  { id: 2, nome: "Nonno", pais_nasc: "Italia", data_nasc: "1930-01-01", sexo: "M" },
] as PessoaEntrada[]
const comCiclo = [
  { id: 1, nome: "Req", requerente: "sim", paiId: 2, data_nasc: "1990-01-01" },
  { id: 2, nome: "Nonno", pais_nasc: "Italia", paiId: 1, data_nasc: "1930-01-01", sexo: "M" },
] as PessoaEntrada[]

const fotoAntes = fotografar(estado(sadio))
const fotoDepois = fotografar(estado(comCiclo))

const contagens = {
  pessoasAfetadas: 1,
  arvoresAfetadas: 1,
  requerentesAfetados: 0,
  processosAfetados: 1,
  vinculosAlterados: 1,
  documentosRelacionados: 1,
  necessidadesRecalculadas: 0,
}
const impacto = analisarImpacto({ antes: fotoAntes, depois: fotoDepois, contagens, linhaAprovadaPorHumano: true })
ok(impacto.bloqueado === true, "criar ciclo BLOQUEIA a aplicação")
ok(impacto.motivoBloqueio?.includes("CRÍTICA") === true, "com motivo explícito", impacto.motivoBloqueio)
ok(impacto.inconsistenciasCriadas.length > 0, "e lista as inconsistências criadas")
ok(impacto.resumo.includes("pessoa(s)"), "resumo legível para auditoria", impacto.resumo)

const semMudanca = analisarImpacto({ antes: fotoAntes, depois: fotoAntes, contagens, linhaAprovadaPorHumano: true })
ok(semMudanca.bloqueado === false, "sem inconsistência nova não bloqueia")

const semAprovacaoLinha = analisarImpacto({
  antes: fotoAntes,
  depois: fotografar(
    estado([
      { id: 1, nome: "Req", requerente: "sim", paiId: 3, data_nasc: "1990-01-01" },
      { id: 3, nome: "Outro", pais_nasc: "Italia", data_nasc: "1935-01-01", sexo: "M" },
    ] as PessoaEntrada[]),
  ),
  contagens,
  linhaAprovadaPorHumano: false,
})
ok(semAprovacaoLinha.bloqueado === true, "mudar a linha sem aprovação humana bloqueia", semAprovacaoLinha.motivoBloqueio)

const revBase = {
  antes: fotoAntes,
  depois: fotoAntes,
  associacoesDocumentais: [],
  necessidadesAtendidas: [],
  processosTocados: [1],
  processosAutorizados: [1],
  evidenciaContrariaMaisForte: false,
  linhaAprovadaPorHumano: true,
}
ok(revalidar(revBase).ok === true, "revalidação passa quando nada mudou")

ok(revalidar({ ...revBase, depois: fotoDepois }).criticas.some((f) => f.verificacao === "nao_criou_ciclo"), "1/10 ciclo")
ok(
  revalidar({
    ...revBase,
    associacoesDocumentais: [{ documentoId: 9, pessoaId: 5, pessoaEsperadaId: 6 }],
  }).criticas.some((f) => f.verificacao === "documento_associado_a_pessoa_correta"),
  "4/10 documento associado à pessoa errada",
)
ok(
  revalidar({
    ...revBase,
    necessidadesAtendidas: [{ necessidadeId: 3, temDocumentoVinculado: false }],
  }).criticas.some((f) => f.verificacao === "nao_satisfez_necessidade_incorreta"),
  "5/10 necessidade atendida sem documento",
)
ok(
  revalidar({ ...revBase, processosTocados: [1, 99], processosAutorizados: [1] }).criticas.some(
    (f) => f.verificacao === "nao_alterou_outro_processo",
  ),
  "6/10 processo fora do escopo autorizado",
)
ok(
  revalidar({ ...revBase, evidenciaContrariaMaisForte: true }).criticas.some(
    (f) => f.verificacao === "nao_contradisse_evidencia_mais_forte",
  ),
  "7/10 evidência contrária mais forte",
)
const comprovadoAntes = fotografar(
  estado(sadio, new Map([[1, new Set<CampoRegistral>(["DATA_NASCIMENTO", "FILIACAO_PAI", "FILIACAO_MAE"])], [2, new Set<CampoRegistral>(["DATA_NASCIMENTO"])]])),
)
ok(
  revalidar({ ...revBase, antes: comprovadoAntes, depois: fotoAntes }).criticas.some(
    (f) => f.verificacao === "nao_removeu_linhagem_valida",
  ),
  "3/10 perda de linhagem comprovada",
)
const bio = fotografar(
  estado([
    { id: 1, nome: "Req", requerente: "sim", paiId: 2, data_nasc: "1990-01-01" },
    { id: 2, nome: "Nonno", pais_nasc: "Italia", data_nasc: "2000-01-01", sexo: "M" },
  ] as PessoaEntrada[]),
)
const revBio = revalidar({ ...revBase, depois: bio })
ok(
  revBio.criticas.some((f) => f.verificacao === "nao_criou_relacao_biologicamente_impossivel"),
  "9/10 relação biologicamente impossível",
  revBio.criticas.map((f) => f.verificacao),
)
ok(
  revalidar({ ...revBase, depois: bio, linhaAprovadaPorHumano: false }).criticas.some(
    (f) => f.verificacao === "nao_alterou_elegibilidade_sem_revisao",
  ),
  "10/10 elegibilidade alterada sem revisão",
)

// ============================================================
console.log("\n8) VERSÃO — snapshot determinístico e comparação")
const snapA = montarSnapshot({
  arvoreId: 1,
  pessoas: sadio,
  unioes: [],
  fatos: [{ pessoaId: 1, uniaoId: null, campo: "DATA_NASCIMENTO", valorNormalizado: "1990-01-01", estado: "CONFIRMADO", confianca: "CONFIRMADO", versao: 1 }],
  aliases: [{ pessoaId: 1, nome: "Req", sobrenome: null, tipo: "REGISTRAL", principal: true }],
  linha: [1, 2],
  ascendenteTransmissorId: 2,
  resultadoLinhagem: "LINHA_COMPLETA_COM_PENDENCIAS",
})
const snapA2 = montarSnapshot({
  arvoreId: 1,
  // ordem de entrada invertida: o snapshot tem de sair igual
  pessoas: [...sadio].reverse(),
  unioes: [],
  fatos: [{ pessoaId: 1, uniaoId: null, campo: "DATA_NASCIMENTO", valorNormalizado: "1990-01-01", estado: "CONFIRMADO", confianca: "CONFIRMADO", versao: 1 }],
  aliases: [{ pessoaId: 1, nome: "Req", sobrenome: null, tipo: "REGISTRAL", principal: true }],
  linha: [1, 2],
  ascendenteTransmissorId: 2,
  resultadoLinhagem: "LINHA_COMPLETA_COM_PENDENCIAS",
})
ok(hashDoSnapshot(snapA) === hashDoSnapshot(snapA2), "hash independe da ordem de leitura do banco")
ok(serializarCanonico({ b: 1, a: 2 }) === serializarCanonico({ a: 2, b: 1 }), "serialização canônica ordena chaves")

const snapB = montarSnapshot({
  arvoreId: 1,
  pessoas: [{ ...sadio[0], nome: "Requerente" }, sadio[1]] as PessoaEntrada[],
  unioes: [],
  fatos: [],
  aliases: [{ pessoaId: 1, nome: "Req", sobrenome: null, tipo: "REGISTRAL", principal: true }, { pessoaId: 1, nome: "Requerente", sobrenome: null, tipo: "GRAFIA_DOCUMENTO", principal: false }],
  linha: [1, 2],
  ascendenteTransmissorId: 2,
  resultadoLinhagem: "LINHA_COMPLETA_COM_PENDENCIAS",
})
ok(hashDoSnapshot(snapA) !== hashDoSnapshot(snapB), "conteúdo diferente → hash diferente")

const cmp = compararSnapshots(snapA, snapB)
ok(cmp.iguais === false, "comparação detecta diferença")
ok(cmp.mudancas.some((m) => m.entidade === "PESSOA" && m.campo === "nome"), "nome alterado é listado", cmp.mudancas.map((m) => m.descricao))
ok(cmp.mudancas.some((m) => m.entidade === "FATO" && m.tipo === "REMOVIDO"), "fato que deixou de estar ativo é listado")
ok(cmp.mudancas.some((m) => m.entidade === "ALIAS" && m.tipo === "ADICIONADO"), "alias novo é listado")
ok(compararSnapshots(snapA, snapA).iguais === true, "snapshot igual a si mesmo")

console.log("\n9) REVERSÃO — nunca exclui pessoa")
const plano = planejarReversao(snapB, snapA)
ok(plano.operacoes.some((o) => o.acao === "RESTAURAR_CAMPO" && o.campo === "nome"), "restaura o nome", plano.operacoes.map((o) => o.descricao))
ok(plano.operacoes.some((o) => o.acao === "DESATIVAR_ALIAS"), "desativa o alias acrescentado")
ok(plano.operacoes.some((o) => o.acao === "REATIVAR_FATO" || o.acao === "DESATIVAR_FATO"), "trata o fato sem apagar histórico")

const comPessoaNova = montarSnapshot({
  arvoreId: 1,
  pessoas: [...sadio, { id: 99, nome: "Nova" }] as PessoaEntrada[],
  unioes: [],
  fatos: [],
  aliases: [],
  linha: [1, 2],
  ascendenteTransmissorId: 2,
  resultadoLinhagem: null,
})
const planoPessoa = planejarReversao(comPessoaNova, snapA)
ok(
  planoPessoa.impossivel.some((m) => m.includes("Exclusão automática de pessoa é proibida")),
  "reverter criação de pessoa NÃO exclui: devolve pendência humana",
  planoPessoa.impossivel,
)
ok(
  !planoPessoa.operacoes.some((o) => String(o.acao).includes("EXCLUIR")),
  "nenhuma operação de exclusão é gerada",
)

// ============================================================
console.log("\n10) CHAVES DE IDEMPOTÊNCIA — determinísticas e dentro do limite")
const kLote1 = chaveLote({ processoId: 7, documentoIds: [3, 1, 2], versaoMotor: "1.0.0" })
const kLote2 = chaveLote({ processoId: 7, documentoIds: [1, 2, 3], versaoMotor: "1.0.0" })
ok(kLote1 === kLote2, "ordem dos documentos não muda a chave do lote")
ok(kLote1 !== chaveLote({ processoId: 7, documentoIds: [1, 2], versaoMotor: "1.0.0" }), "conjunto diferente → chave diferente")
ok(kLote1 !== chaveLote({ processoId: 7, documentoIds: [1, 2, 3], versaoMotor: "2.0.0" }), "versão do motor entra na chave")

const chaves = [
  chaveExecucao({ loteId: 1, documentoId: 2 }),
  chaveOcorrencia({ execucaoId: 1, papel: "PAI", nomeNormalizado: "GIUSEPPE BIANCHI" }),
  chaveEvidencia({ documentoId: 1, campo: "NOME_REGISTRAL", papel: "REGISTRADO", valorNormalizado: "X".repeat(500), metodo: "m", pessoaId: 1 }),
  chaveFato({ pessoaId: 1, campo: "NOME_REGISTRAL", versao: 3 }),
  chaveProposta({ processoId: 1, tipo: "CORRIGIR_DADO", entidadeAlvo: "PESSOA", alvoId: 1, campo: "NOME_REGISTRAL", valorProposto: "Y".repeat(500) }),
  chaveConflito({ processoId: 1, codigo: "LEITURA_DIVERGENTE", pessoaId: 1, campo: "NOME_REGISTRAL", assinatura: "Z".repeat(500) }),
  chaveDecisao({ propostaId: 1, decisao: "APROVAR", responsavelId: 2, rodada: 0 }),
]
ok(chaves.every((k) => k.length <= 200), "toda chave cabe em VARCHAR(200)", chaves.map((k) => k.length))
ok(new Set(chaves).size === chaves.length, "chaves de tipos diferentes não colidem")
ok(
  chaveEvidencia({ documentoId: 1, campo: "NOME_REGISTRAL", papel: "REGISTRADO", valorNormalizado: "V", metodo: "A", pessoaId: 1 }) !==
    chaveEvidencia({ documentoId: 1, campo: "NOME_REGISTRAL", papel: "REGISTRADO", valorNormalizado: "V", metodo: "B", pessoaId: 1 }),
  "o MÉTODO entra na chave: leitura A e leitura B são duas evidências",
)
ok(
  chaveFato({ pessoaId: 1, campo: "NOME_REGISTRAL", versao: 1 }) !== chaveFato({ pessoaId: 1, campo: "NOME_REGISTRAL", versao: 2 }),
  "a versão entra na chave do fato (append-only)",
)
ok(
  chaveDecisao({ propostaId: 1, decisao: "APROVAR", responsavelId: 2, rodada: 0 }) !==
    chaveDecisao({ propostaId: 1, decisao: "APROVAR", responsavelId: 2, rodada: 1 }),
  "a rodada permite aprovar → reverter → aprovar sem colidir",
)
ok(hashEstavel("abc") === hashEstavel("abc") && hashEstavel("abc") !== hashEstavel("abd"), "hash é estável e sensível")
ok(correlationId({ prefixo: "p", processoId: 1, referencia: 2, instante: 1 }).length <= 60, "correlationId cabe na coluna")
ok(
  !JSON.stringify(chaves).match(/\d{13}/),
  "nenhuma chave contém timestamp (senão reprocessar duplicaria)",
)

// ============================================================
console.log("\n11) MÉTRICAS e REDAÇÃO de conteúdo sensível")
const redigido = redigirParaLog({
  nome: "MARIA SOUZA BIANCHI",
  nomePai: "GIUSEPPE BIANCHI",
  trechoTexto: "aos vinte e cinco dias do mês de janeiro",
  cpf: "12345678901",
  documentoId: 42,
  confianca: 0.93,
  aninhado: { sobrenome: "BIANCHI", pagina: 3 },
}) as Record<string, unknown>
ok(redigido.nome === "M…(19)", "nome é reduzido a inicial + tamanho", redigido.nome)
ok(String(redigido.nomePai).startsWith("G…"), "filiação é reduzida")
ok(String(redigido.trechoTexto).startsWith("a…"), "trecho do documento é reduzido")
ok(String(redigido.cpf).startsWith("1…"), "CPF é reduzido")
ok(redigido.documentoId === 42, "id permanece (é o que permite investigar)")
ok(redigido.confianca === 0.93, "número permanece")
ok(String((redigido.aninhado as Record<string, unknown>).sobrenome).startsWith("B…"), "redação é recursiva")
ok((redigido.aninhado as Record<string, unknown>).pagina === 3, "campo não sensível aninhado permanece")
ok(!JSON.stringify(redigido).includes("MARIA SOUZA BIANCHI"), "o nome completo NÃO aparece no log")
ok(!JSON.stringify(redigido).includes("12345678901"), "o CPF completo NÃO aparece no log")
ok(reduzir(null) === "∅", "nulo é marcado")
ok(CAMPOS_SENSIVEIS.includes("trechoTexto"), "trecho do documento está na lista de sensíveis")

const ciclico: Record<string, unknown> = { a: 1 }
ciclico.self = ciclico
ok(JSON.stringify(redigirParaLog(ciclico)).includes("ciclo"), "objeto cíclico não trava o redator")

const j = janelaDe(new Date("2026-07-30T14:37:52.123Z"))
ok(j.toISOString() === "2026-07-30T14:00:00.000Z", "janela é a hora cheia em UTC", j.toISOString())

const ms = metricasDoLote({
  processoId: 1,
  totalDocumentos: 10,
  processados: 8,
  falhos: 2,
  camposExtraidos: 40,
  camposDivergentes: 4,
  conflitosAbertos: 3,
  propostasCriadas: 20,
  propostasAutomaticas: 5,
  evidenciasCriadas: 80,
  pessoasCriadas: 2,
  vinculosCriados: 3,
  duplicidadesEvitadas: 1,
  duracaoMs: 8000,
})
const porChave = new Map(ms.map((m) => [m.chave, m.valor]))
ok(porChave.get(METRICAS.DOCUMENTOS_PROCESSADOS) === 8, "documentos processados")
ok(porChave.get(METRICAS.TEMPO_POR_DOCUMENTO_MS) === 1000, "tempo médio por documento", porChave.get(METRICAS.TEMPO_POR_DOCUMENTO_MS))
ok(porChave.get(METRICAS.TAXA_CONFLITO) === 0.1, "taxa de conflito = divergentes/extraídos", porChave.get(METRICAS.TAXA_CONFLITO))
ok(porChave.get(METRICAS.TAXA_REVISAO_HUMANA) === 0.75, "taxa de revisão humana", porChave.get(METRICAS.TAXA_REVISAO_HUMANA))
ok(porChave.get(METRICAS.ERROS) === 2, "erros contados")
ok(ms.every((m) => m.escopo === "processo:1"), "escopo por processo")
ok(
  metricasDoLote({
    processoId: 1, totalDocumentos: 0, processados: 0, falhos: 0, camposExtraidos: 0, camposDivergentes: 0,
    conflitosAbertos: 0, propostasCriadas: 0, propostasAutomaticas: 0, evidenciasCriadas: 0, pessoasCriadas: 0,
    vinculosCriados: 0, duplicidadesEvitadas: 0, duracaoMs: 0,
  }).every((m) => Number.isFinite(m.valor)),
  "lote vazio não produz NaN nem divisão por zero",
)

// ============================================================
console.log("\n12) COPILOTO — responde só com dado do Discovery")
const eleg: ResultadoElegibilidade = {
  requerenteId: 1,
  ascendenteTransmissorId: 2,
  caminhoPrincipal: { ids: [1, 2], geracoesSemComprovacao: [2], quebraEm: null, comprovado: false },
  caminhosAlternativos: [],
  resultado: "LINHA_COMPLETA_COM_PENDENCIAS",
  explicacao: "linha estruturalmente completa, sem comprovação em 1 geração",
  pendencias: ["Nonno: sem comprovação de data de nascimento."],
  conflitos: [],
  comprovadoDocumentalmente: false,
}
const dossie: DossieCopiloto = {
  processoId: 1,
  arvoreId: 1,
  nomePorPessoa: new Map([
    [1, "Joao Requerente"],
    [2, "Giuseppe Nonno"],
  ]),
  elegibilidade: eleg,
  inconsistencias: [
    { codigo: "DIVERGENCIA_ARVORE_CERTIDAO", severidade: "ALTO", pessoaIds: [1], descricao: "documento diverge", explicacao: "x", acaoSugerida: "revisar", evidencias: [] },
  ],
  fatos: [
    {
      pessoaId: 1,
      uniaoId: null,
      campo: "DATA_NASCIMENTO",
      valorNormalizado: "1990-01-01",
      estado: "CONFIRMADO",
      confianca: "CONFIRMADO",
      evidencias: [{ documentoId: 42, rotulo: "Certidão de nascimento", metodo: "ancora_rotulo", favoravel: true }],
    },
    {
      pessoaId: 1,
      uniaoId: null,
      campo: "FILIACAO_PAI",
      valorNormalizado: "GIUSEPPE",
      estado: "DIVERGENTE",
      confianca: "CONTESTADO",
      evidencias: [{ documentoId: 43, rotulo: "Certidão de casamento", metodo: "gramatica_registral", favoravel: false }],
    },
  ],
  necessidadesAbertas: [
    { id: 5, pessoaId: 2, uniaoId: null, item: "Certidão de nascimento italiana", status: "PENDENTE", obrigatoria: true },
  ],
  propostasPendentes: [
    { id: 9, tipo: "CORRIGIR_DADO", criticidade: "APROVACAO_HUMANA", descricao: "corrigir data", pessoasAfetadas: [1] },
  ],
}

const perguntas: Array<[string, string]> = [
  ["quem transmite a cidadania?", "QUEM_TRANSMITE"],
  ["qual é a linha genealógica?", "QUAL_LINHA"],
  ["onde está a quebra da linha?", "ONDE_QUEBRA"],
  ["quais vínculos não estão comprovados?", "VINCULOS_NAO_COMPROVADOS"],
  ["quais certidões faltam?", "CERTIDOES_FALTANDO"],
  ["quais dados divergem?", "DADOS_DIVERGENTES"],
  ["quais pessoas podem estar duplicadas?", "POSSIVEIS_DUPLICIDADES"],
  ["por que esta informação foi confirmada?", "POR_QUE_CONFIRMADO"],
  ["qual documento comprova o vínculo?", "QUAL_DOCUMENTO_COMPROVA"],
  ["qual impacto uma correção causará?", "IMPACTO_DE_CORRECAO"],
]
for (const [pergunta, intencao] of perguntas) {
  ok(classificarPergunta(pergunta) === intencao, `classifica: "${pergunta}"`, classificarPergunta(pergunta))
  const r = responder(pergunta, dossie)
  ok(r.intencao === intencao, `responde a intenção certa: ${intencao}`)
  ok(!!r.conclusao, `${intencao}: tem conclusão`)
  ok(r.origemDosDados.length > 0 || r.semDados, `${intencao}: declara a origem dos dados`)
  ok(r.confianca >= 0 && r.confianca <= 1, `${intencao}: confiança em 0..1`)
}

const quem = responder("quem transmite a cidadania?", dossie)
ok(quem.conclusao.includes("Giuseppe Nonno"), "nomeia o ascendente transmissor", quem.conclusao)
ok(quem.confianca < 0.9, "confiança baixa porque a linha não está comprovada", quem.confianca)
ok(quem.pendencias.length > 0, "e devolve as pendências")

const doc = responder("qual documento comprova o vínculo?", dossie)
ok(doc.evidencias.some((e) => e.includes("#43") || e.includes("Certidão")), "cita o documento comprobatório", doc.evidencias)

const porque = responder("por que foi confirmado?", dossie)
ok(porque.evidencias.some((e) => e.includes("doc #42")), "explica pela evidência documental", porque.evidencias)

const naoSei = responder("qual a receita de bolo?", dossie)
ok(naoSei.intencao === "NAO_RECONHECIDA", "pergunta fora de escopo não é respondida")
ok(naoSei.semDados === true, "e é marcada como sem dado")
ok(naoSei.evidencias.length === 0, "sem evidência inventada")

const dossieVazio: DossieCopiloto = {
  ...dossie,
  elegibilidade: { ...eleg, ascendenteTransmissorId: null, caminhoPrincipal: null },
  fatos: [],
  necessidadesAbertas: [],
  inconsistencias: [],
  propostasPendentes: [],
}
const semDado = responder("quem transmite a cidadania?", dossieVazio)
ok(semDado.semDados === true, "sem transmissor apurado → responde 'sem dado', não inventa")
ok(semDado.confianca === 0, "e confiança zero")
ok(responder("quais certidões faltam?", dossieVazio).conclusao.includes("Não há"), "sem necessidade aberta diz que não há")

ok(severidadeDoDossie(dossie) === "ALTO", "severidade do dossiê reflete o achado ALTO", severidadeDoDossie(dossie))
ok(
  severidadeDoDossie({ ...dossie, inconsistencias: [{ ...dossie.inconsistencias[0], severidade: "CRITICO" }] }) === "CRITICO",
  "achado crítico eleva a severidade",
)

// ============================================================
console.log(`\n${"=".repeat(60)}`)
console.log(`MRG decisão/impacto/versão/copiloto: ${passed} passou, ${failed} falhou`)
if (failed) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
