// src/services/executar-acao-cadastrada.ts
// ============================================================================
// A PORTA ENTRE "O OPERADOR ESCOLHEU UM RESULTADO" E "O DOMÍNIO MUDOU".
//
// ─── O QUE ELA SUBSTITUI ────────────────────────────────────────────────────
// O executor React tinha a lista de resultados possíveis e, para cada um, o que
// fazer: um `switch` sobre "aprovado" | "nova_via" | "rejeitado" que decidia status
// de documento e para onde o processo ia. O servidor não sabia quais resultados
// existiam nem podia recusar um que não existisse. E o resultado "rejeitado ·
// retificação", escolhido na Emissão, mandava o processo para a Retificação — uma
// decisão jurídica tomada na fase errada, por um componente de tela.
//
// ─── COMO FUNCIONA AGORA ────────────────────────────────────────────────────
// A ação vem do cadastro CONGELADO da versão que a execução registrou — não do
// cadastro de hoje. O que ela faz é um `effectKey` do catálogo. Antes de executar,
// esta porta confere de novo tudo o que a publicação já tinha conferido: o efeito
// existe, a FASE tem competência para ele, o executor sabe disparar, os campos
// obrigatórios vieram, e quem clicou tem a permissão. A publicação é a primeira
// linha; esta é a que vale, porque é ela que roda com o dado real.
//
// ─── O QUE FICA REGISTRADO ──────────────────────────────────────────────────
// Na TENTATIVA vigente (Gate 2): a ação, o efeito, os valores e o resultado. É
// assim que "o que foi decidido, quando, por quem e com quais opções disponíveis"
// continua respondível depois que a configuração mudar.
// ============================================================================

import { prisma } from "@/lib/prisma"
import { definicaoHistoricaDoPasso } from "@/src/services/versao-publicada"
import type { AcaoCongelada, CampoCongelado } from "@/src/services/versao-publicada"
import { efeito, efeitosDaFase } from "@/src/lib/motor/catalogo-de-efeitos"
import { executorSuportaEfeito } from "@/src/lib/motor/registro-de-executores"
import { executorEfetivo } from "@/src/services/validacao-de-publicacao"
import { registrarNaTentativa, tentativaVigente } from "@/src/services/execucao-do-passo"
import { requisitosPendentes } from "@/src/services/requisitos-da-etapa"
import { avaliarCondicao, type Condicao } from "@/src/lib/motor/condicoes"
import { concluirPasso, bloquearTarefa, desbloquearTarefa } from "@/src/services/task-step-sync"
import { novaViaDocumental, invalidarDocumento, marcarDocumentoRecebido, aprovarParaAnalise, concluirDocumento, registrarDivergencia, decidirRetificacao } from "@/src/services/efeitos-de-dominio"

export interface ResultadoDaAcao {
  ok: boolean
  codigo?: string
  mensagem?: string
  efeito?: string
  concluiuPasso?: boolean
  detalhes?: Record<string, unknown>
}

export interface ContextoDaAcao {
  usuarioId: number | null
  permissoes: string[]
  correlationId: string
  origem?: "USER" | "MOTOR" | "SYSTEM"
}

function faltando(campos: CampoCongelado[], acao: AcaoCongelada, valores: Record<string, unknown>): string[] {
  const def = efeito(acao.effectKey)
  const exigidos = new Set<string>([...(acao.requerCampos ?? []), ...(def?.camposObrigatorios ?? [])])
  // Campo escondido por condição não é exigido: pedir o que não aparece é pedir o
  // impossível. A publicação recusa "obrigatório + condicional" justamente por isso;
  // esta linha protege o dado antigo, publicado antes daquela validação existir.
  for (const c of campos) {
    if (!c.obrigatorio || c.ativo === false) continue
    if (!avaliarCondicao(c.condicao as Condicao | null, { valores })) continue
    exigidos.add(c.key)
  }
  const falta: string[] = []
  for (const k of exigidos) {
    const v = valores[k]
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) falta.push(k)
  }
  return falta
}

/**
 * EXECUTA UMA AÇÃO CADASTRADA de um passo em execução.
 *
 * Devolve recusa explicada em vez de lançar: a tela precisa poder dizer ao operador
 * POR QUE não deu — "a fase não tem competência para isso" é uma informação, não um
 * erro de sistema.
 */
export async function executarAcaoCadastrada(
  stepInstanceId: number,
  acaoKey: string,
  valores: Record<string, unknown>,
  ctx: ContextoDaAcao,
): Promise<ResultadoDaAcao> {
  const passo = await prisma.phaseWorkflowStepInstance.findUnique({
    where: { id: stepInstanceId },
    select: { id: true, stepKey: true, status: true, faseMacroKey: true, processoId: true, documentoId: true, necessidadeId: true },
  })
  if (!passo) return { ok: false, codigo: "PASSO_INEXISTENTE", mensagem: "Etapa não encontrada." }

  // A CONFIGURAÇÃO DA ÉPOCA, não a de hoje. Se um resultado foi retirado do cadastro
  // depois que esta execução começou, ele continua existindo para ela — e um
  // resultado acrescentado depois NÃO aparece aqui.
  const hist = await definicaoHistoricaDoPasso(stepInstanceId)
  if (!hist) {
    return { ok: false, codigo: "SEM_CONFIGURACAO_HISTORICA",
      mensagem: "Esta etapa não tem configuração versionada — é anterior ao versionamento. Use o painel da etapa." }
  }
  const acao = hist.passo.acoes.find((a) => a.key === acaoKey && a.ativo !== false)
  if (!acao) {
    return { ok: false, codigo: "ACAO_INEXISTENTE",
      mensagem: `A ação "${acaoKey}" não existe na versão ${hist.versao} desta etapa.` }
  }

  const def = efeito(acao.effectKey)
  if (!def) {
    return { ok: false, codigo: "EFEITO_INEXISTENTE",
      mensagem: `A ação aponta para o efeito "${acao.effectKey}", que não existe no catálogo.` }
  }

  // COMPETÊNCIA DA FASE — a trava que impede a Emissão de decidir retificação.
  const fase = await prisma.catalogoFase.findUnique({
    where: { phaseKey: passo.faseMacroKey }, select: { efeitosPermitidos: true },
  })
  if (!efeitosDaFase(passo.faseMacroKey, fase?.efeitosPermitidos ?? null).includes(acao.effectKey)) {
    return { ok: false, codigo: "EFEITO_FORA_DE_COMPETENCIA",
      mensagem: `"${def.label}" é competência de ${def.competencia}, e a fase atual não a tem. Quem decide isso é outra fase.` }
  }

  const exec = executorEfetivo({ key: passo.stepKey, executorKey: hist.passo.executorKey }, passo.faseMacroKey)
  if (!executorSuportaEfeito(exec, acao.effectKey)) {
    return { ok: false, codigo: "EFEITO_SEM_SUPORTE",
      mensagem: `O painel desta etapa não sabe executar "${def.label}".` }
  }

  const permissao = acao.permissao ?? def.permissao
  if (permissao && !ctx.permissoes.includes(permissao)) {
    return { ok: false, codigo: "SEM_PERMISSAO", mensagem: `Esta ação exige a permissão "${permissao}".` }
  }

  // A AÇÃO PODE ESTAR ESCONDIDA POR CONDIÇÃO. Se ela não deveria aparecer com estes
  // valores, executá-la é contornar a regra — e o cliente pode ter mandado a chave
  // mesmo sem o botão existir na tela.
  if (!avaliarCondicao(acao.condicao as Condicao | null, { valores })) {
    return { ok: false, codigo: "ACAO_INDISPONIVEL",
      mensagem: `"${acao.label}" não está disponível com o que foi preenchido.` }
  }

  // O CANAL ESCOLHIDO PRECISA SER UM DOS OFERECIDOS POR ESTA VERSÃO. Sem isto, o
  // cliente poderia mandar um canal inativado — ou inexistente — e o servidor aceitaria.
  //
  // QUAL CAMPO CARREGA O CANAL é uma pergunta de cadastro, não de convenção de nome.
  // Um campo cujas opções apontam para o catálogo de canais É o campo do canal; sem
  // essa declaração, vale a chave reservada `canal`. E se um campo com essa chave tem
  // opções PRÓPRIAS cadastradas, ele não é o campo do canal — o valor dele é julgado
  // logo abaixo, pelas opções dele. Julgar a mesma escolha por dois vocabulários
  // diferentes recusaria configuração legítima.
  const canaisDaVersao = hist.passo.canais ?? []
  const campoDoCatalogo = hist.passo.campos.find((c) => {
    const o = c.opcoes as { catalogo?: string } | unknown[] | null
    return !!o && !Array.isArray(o) && typeof o === "object" && (o as { catalogo?: string }).catalogo === "canais"
  })
  const campoCanalPadrao = hist.passo.campos.find((c) => c.key === "canal")
  const chaveDoCanal = campoDoCatalogo
    ? campoDoCatalogo.key
    : campoCanalPadrao && (campoCanalPadrao.opcoesCadastradas ?? []).length > 0
      ? null
      : "canal"
  const canalEscolhido = chaveDoCanal && typeof valores[chaveDoCanal] === "string" ? (valores[chaveDoCanal] as string) : null
  if (canalEscolhido && canaisDaVersao.length > 0) {
    const ofertado = canaisDaVersao.find((c) => c.key === canalEscolhido && c.ativo !== false)
    if (!ofertado) {
      return { ok: false, codigo: "CANAL_INVALIDO",
        mensagem: `O canal "${canalEscolhido}" não é oferecido por esta etapa nesta versão.` }
    }
  }

  // AS OPÇÕES ESCOLHIDAS PRECISAM EXISTIR. Mesma razão: a autoridade é do servidor.
  for (const campo of hist.passo.campos) {
    const cadastradas = (campo.opcoesCadastradas ?? []).filter((o) => o.ativo !== false)
    if (cadastradas.length === 0) continue
    const v = valores[campo.key]
    const escolhidas = Array.isArray(v) ? v : v == null || v === "" ? [] : [v]
    for (const e of escolhidas) {
      if (!cadastradas.some((o) => o.key === e)) {
        return { ok: false, codigo: "OPCAO_INVALIDA",
          mensagem: `"${String(e)}" não é uma opção válida de "${campo.label}" nesta versão.` }
      }
    }
  }

  const falta = faltando(hist.passo.campos, acao, valores)
  if (falta.length) {
    const rotulos = falta.map((k) => hist.passo.campos.find((c) => c.key === k)?.label ?? k)
    return { ok: false, codigo: "CAMPO_OBRIGATORIO",
      mensagem: `Preencha antes de continuar: ${rotulos.join(", ")}.` }
  }

  // OS REQUISITOS CADASTRADOS — a mesma conta que a tela mostrou, cobrada aqui.
  const pendentes = await requisitosPendentes({
    stepInstanceId, requisitos: hist.passo.requisitos ?? [], campos: hist.passo.campos,
    checklist: hist.passo.checkItens, canais: canaisDaVersao, valores, acaoKey: acao.key,
  })
  if (pendentes.length > 0) {
    return { ok: false, codigo: "REQUISITO_PENDENTE",
      mensagem: pendentes.map((p) => p.motivo).join(" "), detalhes: { pendencias: pendentes } }
  }

  // ── EFEITO ──────────────────────────────────────────────────────────────
  const sync = { origem: (ctx.origem ?? "USER") as "USER", usuarioId: ctx.usuarioId ?? undefined, correlationId: ctx.correlationId }
  const alvo = { stepInstanceId, documentoId: passo.documentoId, processoId: passo.processoId, valores, sync, usuarioId: ctx.usuarioId ?? null }
  let detalhes: Record<string, unknown> = {}

  switch (acao.effectKey) {
    case "COMPLETE_STEP": break
    case "REGISTER_ONLY": break
    case "MARK_DOCUMENT_RECEIVED": detalhes = await marcarDocumentoRecebido(alvo); break
    case "APPROVE_FOR_ANALYSIS": detalhes = await aprovarParaAnalise(alvo); break
    case "COMPLETE_DOCUMENT": detalhes = await concluirDocumento(alvo); break
    case "REQUEST_NEW_COPY": detalhes = await novaViaDocumental(alvo); break
    case "REGISTER_DIVERGENCE": detalhes = await registrarDivergencia(alvo); break
    case "GO_RETIFICATION": detalhes = await decidirRetificacao(alvo); break
    case "INVALIDATE_DOCUMENT": detalhes = await invalidarDocumento(alvo); break
    case "PAUSE_FOR_EXTERNAL_WAIT": {
      const t = await prisma.tarefa.findFirst({ where: { workflowStepInstanceId: stepInstanceId }, select: { id: true } })
      if (t) await bloquearTarefa(t.id, { ...sync, motivoCodigo: "AGUARDANDO_TERCEIRO", justificativa: String(valores.motivo ?? "Aguardando retorno externo.") })
      detalhes = { tarefaId: t?.id ?? null }
      break
    }
    case "RESUME": {
      const t = await prisma.tarefa.findFirst({ where: { workflowStepInstanceId: stepInstanceId }, select: { id: true } })
      if (t) await desbloquearTarefa(t.id, sync)
      detalhes = { tarefaId: t?.id ?? null }
      break
    }
    default:
      return { ok: false, codigo: "EFEITO_SEM_HANDLER",
        mensagem: `O efeito "${acao.effectKey}" está no catálogo mas não tem execução ligada.` }
  }

  // ── REGISTRO NA TENTATIVA ───────────────────────────────────────────────
  // O que ficou decidido pertence à TENTATIVA, não ao passo: se este passo for
  // reaberto amanhã, esta decisão continua sendo a desta execução.
  const vigente = await tentativaVigente(stepInstanceId)
  if (vigente) {
    await registrarNaTentativa(stepInstanceId, {
      status: (def.concluiPasso ? "CONCLUIDO" : passo.status) as never,
      resultado: acao.key,
      executadoPorId: ctx.usuarioId,
      payload: {
        ...((vigente.payload as Record<string, unknown>) ?? {}),
        acao: acao.key, efeito: acao.effectKey, versaoDaConfiguracao: hist.versao,
        valores, detalhes, decididoEm: new Date().toISOString(),
      } as never,
    })
  }

  let concluiu = false
  if (def.concluiPasso) {
    const r = await concluirPasso(stepInstanceId, sync)
    concluiu = r.success && r.changed
    if (!r.success) {
      return { ok: false, codigo: r.code, mensagem: "O efeito foi aplicado, mas a etapa não pôde ser concluída.", efeito: acao.effectKey, detalhes }
    }
  }

  await prisma.logAuditoria.create({
    data: {
      acao: "STEP_ACTION_EXECUTED", entidade: "PhaseWorkflowStepInstance", entidadeId: stepInstanceId,
      descricao: `"${acao.label}" (${def.label}) em ${passo.stepKey}, pela configuração da versão ${hist.versao}.`,
      detalhes: { acao: acao.key, efeito: acao.effectKey, versao: hist.versao, valores, detalhes, correlationId: ctx.correlationId } as never,
      usuarioId: ctx.usuarioId,
    },
  }).catch(() => null)

  return { ok: true, efeito: acao.effectKey, concluiuPasso: concluiu, detalhes }
}
