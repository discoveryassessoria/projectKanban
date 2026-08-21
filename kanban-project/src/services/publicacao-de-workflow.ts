// src/services/publicacao-de-workflow.ts
// ============================================================================
// RASCUNHO E PUBLICAÇÃO — separar "guardei" de "publiquei".
//
// ─── O QUE JÁ ERA VERDADE, E O QUE FALTAVA ──────────────────────────────────
// A definição viva SEMPRE foi o rascunho e a versão congelada SEMPRE foi o publicado.
// O modelo já dizia isso. O que faltava era a distinção no COMANDO: salvar publicava
// junto, então cada ajuste virava uma versão e não havia como olhar o que mudaria
// antes de decidir. Quem configura precisa poder mexer, olhar e só então publicar.
//
// Isto NÃO cria uma segunda árvore de definição. O rascunho é a mesma linha; o que
// entra são duas colunas dizendo desde quando ela difere da última versão publicada.
//
// ─── O DIFF É ENTRE O QUE ESTÁ E O QUE VALE ─────────────────────────────────
// Comparar a definição viva com a última versão CONGELADA é a única comparação
// honesta: é exatamente o que os processos novos passariam a ver.
// ============================================================================

import { prisma } from "@/lib/prisma"
import type { Prisma } from "@prisma/client"
import {
  lerVersaoPublicada, congelarVersaoVigente, publicarNovaVersao,
  retratarPassos, INCLUDE_DA_DEFINICAO,
  type PassoCongelado, type AcaoCongelada, type CampoCongelado,
  type ItemChecklistCongelado, type RequisitoCongelado, type OpcaoCongelada,
} from "@/src/services/versao-publicada"
import { validarWorkflowParaPublicar, type ProblemaDePublicacao } from "@/src/services/validacao-de-publicacao"

type TX = Prisma.TransactionClient

export interface MudancaDeConfiguracao {
  escopo: "PASSO" | "SUBTAREFA" | "AÇÃO" | "CAMPO" | "OPÇÃO" | "CANAL" | "CHECKLIST" | "REQUISITO" | "DEPENDÊNCIA" | "SLA" | "RESPONSÁVEL" | "EXECUTOR"
  tipo: "ACRESCENTADO" | "REMOVIDO" | "ALTERADO"
  passo: string
  alvo: string
  detalhe: string
}

export interface PreviewDePublicacao {
  workflowId: string | number
  nome: string
  versaoAtual: number
  versaoNova: number
  temRascunho: boolean
  mudancas: MudancaDeConfiguracao[]
  problemas: ProblemaDePublicacao[]
  podePublicar: boolean
  aviso: string
}

/** A definição VIVA, no mesmo formato da congelada — para comparar maçã com maçã. */
/**
 * A DEFINIÇÃO VIVA, no MESMO formato da congelada — pelo mesmo código.
 *
 * Antes esta função montava o retrato por conta própria. Bastava o congelamento passar
 * a guardar um atributo que ela não montava para o diff dizer "nada mudou" sobre uma
 * mudança real. Agora ela lê com o mesmo `include` e mapeia com o mesmo mapeador: se
 * um dia divergirem, é porque alguém mexeu nos dois.
 */
async function retratoDaDefinicaoViva(workflowId: number, db: typeof prisma | TX = prisma): Promise<PassoCongelado[]> {
  const wf = await db.phaseInternalWorkflow.findUnique({
    where: { id: workflowId },
    include: { passos: INCLUDE_DA_DEFINICAO },
  })
  if (!wf) return []
  return retratarPassos(wf.passos)
}

// ── O QUE SE COMPARA EM CADA CLASSE DE PEÇA ─────────────────────────────────
//
// As listas ficam aqui, e não dentro da comparação, porque o PASSO e a SUBTAREFA têm
// as mesmas peças. Duplicá-las faria a subtarefa comparar menos atributos que o passo,
// e a diferença só apareceria quando alguém renomeasse uma ação de subtarefa e o diff
// dissesse que nada mudou.
type Campos<T> = Array<{ nome: string; ler: (x: T) => unknown }>

const CAMPOS_DA_ACAO: Campos<AcaoCongelada> = [
  { nome: "nome", ler: (x) => x.label }, { nome: "efeito", ler: (x) => x.effectKey },
  { nome: "explicação", ler: (x) => x.descricao }, { nome: "ordem", ler: (x) => x.ordem },
  { nome: "ativa", ler: (x) => x.ativo }, { nome: "condição", ler: (x) => x.condicao },
  { nome: "campos exigidos", ler: (x) => x.requerCampos }, { nome: "permissão", ler: (x) => x.permissao },
]
const CAMPOS_DO_CAMPO: Campos<CampoCongelado> = [
  { nome: "nome", ler: (x) => x.label }, { nome: "tipo", ler: (x) => x.tipo },
  { nome: "obrigatório", ler: (x) => x.obrigatorio }, { nome: "ordem", ler: (x) => x.ordem },
  { nome: "condição", ler: (x) => x.condicao }, { nome: "ajuda", ler: (x) => x.ajuda },
  { nome: "ativo", ler: (x) => x.ativo },
]
const CAMPOS_DO_ITEM: Campos<ItemChecklistCongelado> = [
  { nome: "nome", ler: (x) => x.label }, { nome: "obrigatório", ler: (x) => x.obrigatorio },
  { nome: "explicação", ler: (x) => x.descricao }, { nome: "ordem", ler: (x) => x.ordem },
  { nome: "ativo", ler: (x) => x.ativo },
]
const CAMPOS_DO_REQUISITO: Campos<RequisitoCongelado> = [
  { nome: "nome", ler: (x) => x.label }, { nome: "tipo", ler: (x) => x.tipo },
  { nome: "alvo", ler: (x) => x.alvoKey }, { nome: "obrigatório", ler: (x) => x.obrigatorio },
  { nome: "quantidade mínima", ler: (x) => x.minimo }, { nome: "condição", ler: (x) => x.condicao },
  { nome: "ação", ler: (x) => x.acaoKey }, { nome: "ativo", ler: (x) => x.ativo },
  { nome: "evidência exigida", ler: (x) => x.evidenciaTipoId },
  { nome: "formatos aceitos", ler: (x) => x.mimesPermitidos }, { nome: "momento", ler: (x) => x.momento },
]
const CAMPOS_DA_OPCAO: Campos<OpcaoCongelada> = [
  { nome: "nome", ler: (x) => x.label }, { nome: "explicação", ler: (x) => x.descricao },
  { nome: "ativa", ler: (x) => x.ativo }, { nome: "ordem", ler: (x) => x.ordem },
  { nome: "condição", ler: (x) => x.condicao },
]

/** Compara duas coleções por `key` e descreve o que mudou, em português. */
function compararPorChave<T extends { key: string }>(
  antes: T[], depois: T[], escopo: MudancaDeConfiguracao["escopo"], passo: string,
  rotulo: (x: T) => string, campos: Array<{ nome: string; ler: (x: T) => unknown }>,
): MudancaDeConfiguracao[] {
  const saida: MudancaDeConfiguracao[] = []
  const mapaAntes = new Map(antes.map((x) => [x.key, x]))
  const mapaDepois = new Map(depois.map((x) => [x.key, x]))
  for (const d of depois) {
    if (!mapaAntes.has(d.key)) {
      saida.push({ escopo, tipo: "ACRESCENTADO", passo, alvo: rotulo(d), detalhe: `"${rotulo(d)}" passa a existir` })
      continue
    }
    const a = mapaAntes.get(d.key)!
    for (const c of campos) {
      // O ALVO é nomeado pelo rótulo ANTIGO quando é o próprio rótulo que muda: dizer
      // «"Canal utilizado": nome "Canal usado" → "Canal utilizado"» deixa o
      // administrador achar a linha na tela que ele ainda vê.
      const va = JSON.stringify(c.ler(a) ?? null)
      const vd = JSON.stringify(c.ler(d) ?? null)
      if (va !== vd) {
        saida.push({ escopo, tipo: "ALTERADO", passo, alvo: rotulo(a), detalhe: `${c.nome}: ${va} → ${vd}` })
      }
    }
  }
  for (const a of antes) {
    if (!mapaDepois.has(a.key)) {
      saida.push({ escopo, tipo: "REMOVIDO", passo, alvo: rotulo(a), detalhe: `"${rotulo(a)}" deixa de existir nas versões novas` })
    }
  }
  return saida
}

/**
 * O QUE MUDARIA SE PUBLICASSE AGORA.
 *
 * Somente leitura, e é para ser olhado antes de decidir. Uma remoção aqui NÃO apaga
 * histórico: as versões publicadas continuam com o que tinham, e a linha do diff diz
 * exatamente isso — "deixa de existir nas versões novas".
 */
export async function preverPublicacao(workflowId: number): Promise<PreviewDePublicacao | null> {
  const wf = await prisma.phaseInternalWorkflow.findUnique({
    where: { id: workflowId },
    select: { id: true, name: true, versao: true, rascunhoAlteradoEm: true },
  })
  if (!wf) return null

  const publicada = await lerVersaoPublicada(workflowId, wf.versao)
  const viva = await retratoDaDefinicaoViva(workflowId)
  const antes = publicada?.passos ?? []

  const mudancas: MudancaDeConfiguracao[] = compararPorChave(
    antes, viva, "PASSO", "—", (p) => p.label,
    [
      { nome: "nome", ler: (p) => p.label },
      { nome: "ordem", ler: (p) => p.ordem },
      { nome: "obrigatório", ler: (p) => p.required },
      { nome: "executor", ler: (p) => p.executorKey },
      { nome: "cardinalidade", ler: (p) => p.cardinalidade },
      { nome: "SLA (dias)", ler: (p) => p.slaDays },
      { nome: "responsável padrão", ler: (p) => p.owner },
      { nome: "dependências", ler: (p) => p.dependeDe },
      { nome: "política de reabertura", ler: (p) => [p.reaberturaPermitida, p.reaberturaEstrategia, p.reaberturaExigeJustificativa] },
    ],
  )

  for (const d of viva) {
    const a = antes.find((x) => x.key === d.key)
    if (!a) continue
    mudancas.push(
      // TODO CAMPO QUE O CADASTRO DEIXA EDITAR entra na comparação — a começar pelo
      // RÓTULO, que era justamente o que o diff não via: renomear uma ação aparecia
      // como nada, porque o rótulo é o que dá nome à linha do diff. O que a tela
      // permite mudar e o diff não mostra é uma mudança que ninguém revisa.
      ...compararPorChave(a.acoes ?? [], d.acoes ?? [], "AÇÃO", d.label, (x) => x.label, CAMPOS_DA_ACAO),
      ...compararPorChave(a.campos ?? [], d.campos ?? [], "CAMPO", d.label, (x) => x.label, CAMPOS_DO_CAMPO),
      ...compararPorChave(a.checkItens ?? [], d.checkItens ?? [], "CHECKLIST", d.label, (x) => x.label, CAMPOS_DO_ITEM),
      // O CANAL COMPARA AS QUATRO EXIGÊNCIAS. Faltavam rastreio e observação — e
      // "este passo passou a exigir observação neste canal" é exatamente o tipo de
      // mudança que o operador sente e o administrador precisa ter visto antes.
      ...compararPorChave(a.canais ?? [], d.canais ?? [], "CANAL", d.label, (x) => x.label,
        [{ nome: "nome", ler: (x) => x.label },
         { nome: "exige protocolo", ler: (x) => x.exigeProtocolo }, { nome: "exige anexo", ler: (x) => x.exigeAnexo },
         { nome: "exige rastreio", ler: (x) => x.exigeRastreio }, { nome: "exige observação", ler: (x) => x.exigeObservacao },
         { nome: "campos obrigatórios", ler: (x) => x.camposObrigatorios }, { nome: "condição", ler: (x) => x.condicao },
         { nome: "ativo", ler: (x) => x.ativo }, { nome: "ordem", ler: (x) => x.ordem }]),
      ...compararPorChave(a.requisitos ?? [], d.requisitos ?? [], "REQUISITO", d.label, (x) => x.label, CAMPOS_DO_REQUISITO),
    )
    // ── AS SUBTAREFAS ────────────────────────────────────────────────────
    mudancas.push(
      ...compararPorChave(a.subtarefas ?? [], d.subtarefas ?? [], "SUBTAREFA", d.label, (x) => x.label,
        [{ nome: "nome", ler: (x) => x.label }, { nome: "descrição", ler: (x) => x.descricao },
         { nome: "ordem", ler: (x) => x.ordem }, { nome: "ativa", ler: (x) => x.ativo },
         { nome: "obrigatória", ler: (x) => x.obrigatoria }, { nome: "repetível", ler: (x) => x.repetivel },
         { nome: "máximo de ocorrências", ler: (x) => x.maxOcorrencias },
         { nome: "modo de execução", ler: (x) => x.modoExecucao },
         { nome: "regra de responsável", ler: (x) => x.responsavelRegra },
         { nome: "responsável", ler: (x) => x.responsavelId }, { nome: "SLA (dias)", ler: (x) => x.slaDays },
         { nome: "condição de entrada", ler: (x) => x.condicaoEntrada },
         { nome: "condição de conclusão", ler: (x) => x.condicaoConclusao },
         { nome: "condição de visibilidade", ler: (x) => x.condicaoVisibilidade },
         { nome: "dependências", ler: (x) => x.dependeDe }, { nome: "executor", ler: (x) => x.executorKey },
         { nome: "cardinalidade", ler: (x) => x.cardinalidade },
         { nome: "fonte dos canais", ler: (x) => x.fonteDeCanais },
         { nome: "tipos de canal", ler: (x) => x.tiposDeCanal },
         { nome: "reabertura permitida", ler: (x) => x.reaberturaPermitida },
         { nome: "reabertura exige justificativa", ler: (x) => x.reaberturaExigeJustificativa },
         { nome: "permissão de reabertura", ler: (x) => x.reaberturaPermissao }]),
    )
    // OS FILHOS DE CADA SUBTAREFA — o passo é nomeado como "Passo › Subtarefa", para
    // a linha do diff dizer onde a mudança está sem obrigar a caçar.
    for (const stDepois of d.subtarefas ?? []) {
      const stAntes = (a.subtarefas ?? []).find((x) => x.key === stDepois.key)
      if (!stAntes) continue
      const onde = `${d.label} › ${stDepois.label}`
      mudancas.push(
        ...compararPorChave(stAntes.acoes ?? [], stDepois.acoes ?? [], "AÇÃO", onde, (x) => x.label, CAMPOS_DA_ACAO),
        ...compararPorChave(stAntes.campos ?? [], stDepois.campos ?? [], "CAMPO", onde, (x) => x.label, CAMPOS_DO_CAMPO),
        ...compararPorChave(stAntes.checkItens ?? [], stDepois.checkItens ?? [], "CHECKLIST", onde, (x) => x.label, CAMPOS_DO_ITEM),
        ...compararPorChave(stAntes.requisitos ?? [], stDepois.requisitos ?? [], "REQUISITO", onde, (x) => x.label, CAMPOS_DO_REQUISITO),
      )
      for (const campoDepois of stDepois.campos ?? []) {
        const campoAntes = (stAntes.campos ?? []).find((x) => x.key === campoDepois.key)
        if (!campoAntes) continue
        mudancas.push(...compararPorChave(
          campoAntes.opcoesCadastradas ?? [], campoDepois.opcoesCadastradas ?? [],
          "OPÇÃO", `${onde} › ${campoDepois.label}`, (x) => x.label, CAMPOS_DA_OPCAO))
      }
    }

    // As opções são comparadas dentro de cada campo — a identidade delas é a `key`.
    for (const campoDepois of d.campos ?? []) {
      const campoAntes = (a.campos ?? []).find((x) => x.key === campoDepois.key)
      if (!campoAntes) continue
      mudancas.push(
        ...compararPorChave(
          campoAntes.opcoesCadastradas ?? [], campoDepois.opcoesCadastradas ?? [],
          "OPÇÃO", `${d.label} › ${campoDepois.label}`, (x) => x.label, CAMPOS_DA_OPCAO,
        ),
      )
    }
  }

  const problemas = await validarWorkflowParaPublicar(workflowId)
  return {
    workflowId: wf.id,
    nome: wf.name,
    versaoAtual: wf.versao,
    versaoNova: wf.versao + 1,
    temRascunho: mudancas.length > 0,
    mudancas,
    problemas,
    podePublicar: problemas.length === 0 && mudancas.length > 0,
    aviso:
      "Publicar cria a versão " + (wf.versao + 1) + ". Os processos que já rodam continuam na versão que registraram — " +
      "nada do que eles materializaram muda. O que é removido aqui continua legível no histórico deles.",
  }
}

export interface ResultadoPublicacao {
  ok: boolean
  code?: string
  mensagem?: string
  versaoAnterior?: number
  versaoNova?: number
  problemas?: ProblemaDePublicacao[]
  mudancas?: MudancaDeConfiguracao[]
}

/**
 * PUBLICA. Idempotente por `versaoEsperada`.
 *
 * Dois administradores com a tela aberta, ou um duplo clique, publicariam duas
 * versões — a segunda idêntica à primeira, e a linha do tempo passaria a mentir sobre
 * quantas vezes a configuração mudou. `versaoEsperada` é o que a tela viu: se o
 * número já andou, alguém publicou no meio, e a segunda publicação é recusada com o
 * motivo em vez de sobrescrever silenciosamente.
 */
export async function publicarWorkflow(args: {
  workflowId: number
  actorId: number | null
  /** A versão que a tela tinha em mãos. Ausente = sem trava (chamadas internas). */
  versaoEsperada?: number
}): Promise<ResultadoPublicacao> {
  const preview = await preverPublicacao(args.workflowId)
  if (!preview) return { ok: false, code: "WORKFLOW_INEXISTENTE" }

  if (args.versaoEsperada != null && args.versaoEsperada !== preview.versaoAtual) {
    return {
      ok: false, code: "CONFLITO_DE_VERSAO",
      mensagem: `Alguém publicou enquanto esta tela estava aberta (a versão passou de ${args.versaoEsperada} para ${preview.versaoAtual}). Recarregue e confira o que mudou antes de publicar.`,
    }
  }
  if (preview.problemas.length > 0) {
    return { ok: false, code: "PUBLICACAO_INVALIDA", problemas: preview.problemas }
  }
  if (!preview.temRascunho) {
    // NÃO é erro: é o retry chegando depois de a primeira publicação ter passado.
    return { ok: true, code: "SEM_ALTERACOES", versaoAnterior: preview.versaoAtual, versaoNova: preview.versaoAtual,
      mensagem: "Não há alterações para publicar." }
  }

  let nova = preview.versaoAtual
  // TEMPO SUFICIENTE PARA CONGELAR. Congelar é ler o workflow inteiro — passos,
  // ações, campos, opções, canais, checklist, requisitos — e gravar um snapshot só.
  // Com o banco de produção do outro lado da rede, os 5 s do padrão estouram no meio
  // e a transação morre com a versão já incrementada e o conteúdo por congelar. Não é
  // margem de conforto: é o que separa "não publicou" de "publicou pela metade".
  await prisma.$transaction(async (tx) => {
    const r = await publicarNovaVersao(args.workflowId, tx, args.actorId)
    nova = r.nova
    await congelarVersaoVigente(args.workflowId, "PUBLICACAO", tx, args.actorId)
    await tx.phaseInternalWorkflow.update({
      where: { id: args.workflowId },
      data: { rascunhoAlteradoEm: null, rascunhoAlteradoPor: null },
    })
  }, { maxWait: 20_000, timeout: 120_000 })

  await prisma.logAuditoria.create({
    data: {
      acao: "WORKFLOW_VERSION_PUBLISHED", entidade: "PhaseInternalWorkflow", entidadeId: args.workflowId,
      descricao:
        `"${preview.nome}" publicado na versão ${nova} com ${preview.mudancas.length} alteração(ões). ` +
        `A versão ${preview.versaoAtual} foi congelada e continua valendo para os processos que já a registraram.`,
      detalhes: { versaoAnterior: preview.versaoAtual, versaoNova: nova, mudancas: preview.mudancas } as never,
      usuarioId: args.actorId,
    },
  }).catch(() => null)

  return { ok: true, versaoAnterior: preview.versaoAtual, versaoNova: nova, mudancas: preview.mudancas }
}

/** Marca que a definição viva difere da última publicação. */
export async function marcarRascunho(workflowId: number, actorId: number | null, db: typeof prisma | TX = prisma) {
  await db.phaseInternalWorkflow.update({
    where: { id: workflowId },
    data: { rascunhoAlteradoEm: new Date(), rascunhoAlteradoPor: actorId },
  }).catch(() => null)
}
