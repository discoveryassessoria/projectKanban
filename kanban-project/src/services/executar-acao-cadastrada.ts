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
import { alvoDoCampo, idReferenciado } from "@/src/lib/motor/fontes-de-campo"
import { validarReferencia } from "@/src/services/referencia-canonica"
import { subtarefasDaEtapa, passoPodeConcluir } from "@/src/services/subtarefas-da-etapa"
import { canaisDaSubtarefa } from "@/src/lib/motor/canais-do-fornecedor"
import { registrarNaExecucao, garantirExecucao, ESTADOS_DA_SUBTAREFA } from "@/src/services/execucao-da-subtarefa"
import { requisitosPendentes } from "@/src/services/requisitos-da-etapa"
import { avaliarCondicao, type Condicao } from "@/src/lib/motor/condicoes"
import { concluirPasso, bloquearTarefa, desbloquearTarefa } from "@/src/services/task-step-sync"
import { novaViaDocumental, invalidarDocumento, marcarDocumentoRecebido, aprovarParaAnalise, concluirDocumento, registrarDivergencia, decidirRetificacao, registrarProtocoloDaEtapa } from "@/src/services/efeitos-de-dominio"

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
  /**
   * A SUBTAREFA em que a ação acontece. Ausente = a ação é do PASSO, como sempre foi.
   *
   * Quando presente, tudo se resolve DENTRO dela: a ação vem das ações dela, os campos
   * obrigatórios são os dela, os requisitos cobrados são os dela, e o que ficou
   * decidido é registrado na execução dela — não na tentativa do passo inteiro.
   */
  subtaskKey?: string | null
  /** O fornecedor concreto do documento, para resolver canais e bloqueios. */
  fornecedorId?: number | null
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
  // ── DE ONDE VEM A AÇÃO: do passo ou da subtarefa ────────────────────────
  //
  // A subtarefa tem as ações DELA. Procurar no passo quando a ação é dela faria uma
  // ação de "registrar protocolo" ser recusada por não existir — ou, pior, encontrar
  // uma homônima do passo e executar outra coisa.
  const subtarefa = ctx.subtaskKey
    ? (hist.passo.subtarefas ?? []).find((st) => st.key === ctx.subtaskKey && st.ativo !== false)
    : null
  if (ctx.subtaskKey && !subtarefa) {
    return { ok: false, codigo: "SUBTAREFA_INEXISTENTE",
      mensagem: `A subtarefa "${ctx.subtaskKey}" não existe na versão ${hist.versao} desta etapa.` }
  }

  // A SUBTAREFA PRECISA ESTAR DISPONÍVEL. O cliente pode mandar a chave mesmo sem o
  // botão existir na tela — e executar uma subtarefa bloqueada é contornar a
  // dependência que o administrador declarou.
  if (subtarefa) {
    const projetadas = await subtarefasDaEtapa({
      stepInstanceId, valores, fornecedorId: ctx.fornecedorId ?? null,
    })
    const alvo = projetadas.find((x) => x.key === subtarefa.key)
    if (alvo && !alvo.disponivel && !alvo.concluida) {
      return { ok: false, codigo: "SUBTAREFA_INDISPONIVEL",
        mensagem: alvo.bloqueioTexto ?? `"${subtarefa.label}" não está disponível agora.`,
        detalhes: { bloqueioCodigo: alvo.bloqueioCodigo, bloqueioAlvo: alvo.bloqueioAlvo } }
    }
    // JÁ CONCLUÍDA e não repetível: executar de novo criaria uma segunda conclusão do
    // mesmo fato. Repetir é capacidade declarada, não consequência de clicar duas vezes.
    if (alvo?.concluida && !alvo.podeRepetir) {
      return { ok: false, codigo: "SUBTAREFA_JA_CONCLUIDA",
        mensagem: `"${subtarefa.label}" já foi concluída. Para fazer de novo, é preciso reabri-la.` }
    }
  }

  const acoesDisponiveis = subtarefa ? subtarefa.acoes : hist.passo.acoes
  const camposDisponiveis = subtarefa ? subtarefa.campos : hist.passo.campos
  const acao = acoesDisponiveis.find((a) => a.key === acaoKey && a.ativo !== false)
  if (!acao) {
    return { ok: false, codigo: "ACAO_INEXISTENTE",
      mensagem: subtarefa
        ? `A ação "${acaoKey}" não existe na subtarefa "${subtarefa.label}" da versão ${hist.versao}.`
        : `A ação "${acaoKey}" não existe na versão ${hist.versao} desta etapa.` }
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
  //
  // NUMA SUBTAREFA, os canais vêm do FORNECEDOR concreto — o passo não os lista mais.
  // A lista congelada do passo continua valendo para as ações do próprio passo, que
  // são as publicadas antes de a subtarefa existir.
  const canaisDaVersao = subtarefa
    ? (await canaisDaSubtarefa({
        fonteDeCanais: subtarefa.fonteDeCanais,
        tiposPermitidos: subtarefa.tiposDeCanal,
        fornecedorId: ctx.fornecedorId ?? null,
      })).map((c) => ({
        key: c.key, label: c.label, descricao: c.descricao, ordem: c.ordem, ativo: true,
        exigeProtocolo: c.exigeProtocolo, exigeAnexo: c.exigeAnexo, anexoLabel: c.anexoLabel,
        exigeRastreio: c.exigeRastreio, exigeObservacao: c.exigeObservacao,
        camposObrigatorios: [] as string[], condicao: null as unknown,
      }))
    : (hist.passo.canais ?? [])
  const campoDoCatalogo = camposDisponiveis.find((c) => {
    const o = c.opcoes as { catalogo?: string } | unknown[] | null
    return !!o && !Array.isArray(o) && typeof o === "object" && (o as { catalogo?: string }).catalogo === "canais"
  })
  const campoCanalPadrao = camposDisponiveis.find((c) => c.key === "canal")
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
  for (const campo of camposDisponiveis) {
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

  // ── REFERÊNCIAS A CADASTRO ────────────────────────────────────────────────
  //
  // O formulário manda um número. Quem decide se aquele número existe, é do cadastro
  // certo, está em circulação e se quem está executando pode escolhê-lo é o SERVIDOR —
  // pela mesma razão que a opção de um select é conferida aqui e não lá.
  //
  // O que já estava escolhido nesta execução passa mesmo se tiver sido desativado
  // depois: recusar seria travar uma execução em andamento por uma mudança de cadastro
  // que não é dela.
  const jaGravados = ((await tentativaVigente(stepInstanceId))?.payload as
    { valores?: Record<string, unknown> } | null)?.valores ?? {}
  for (const campo of camposDisponiveis) {
    if (campo.tipo !== "referencia") continue
    const v = valores[campo.key]
    if (v == null || v === "") continue
    const alvoDeclarado = alvoDoCampo(campo.opcoes)
    const r = await validarReferencia({
      alvo: alvoDeclarado ?? "",
      valor: v,
      rotuloDoCampo: campo.label ?? campo.key,
      permissoes: ctx.permissoes ?? [],
      jaEscolhidoAntes: idReferenciado(jaGravados[campo.key]) === idReferenciado(v),
    })
    if (!r.ok) return { ok: false, codigo: `REFERENCIA_${r.motivo}`, mensagem: r.mensagem }
    // O QUE VAI PARA O PAYLOAD É O ID, normalizado a número. Nunca o rótulo: o rótulo
    // é buscado no cadastro a cada leitura, e é isso que faz renomear funcionar.
    valores[campo.key] = r.entidade.id
  }

  const falta = faltando(camposDisponiveis, acao, valores)
  if (falta.length) {
    const rotulos = falta.map((k) => camposDisponiveis.find((c) => c.key === k)?.label ?? k)
    return { ok: false, codigo: "CAMPO_OBRIGATORIO",
      mensagem: `Preencha antes de continuar: ${rotulos.join(", ")}.` }
  }

  // OS REQUISITOS CADASTRADOS — a mesma conta que a tela mostrou, cobrada aqui.
  // OS REQUISITOS SÃO OS DO ESCOPO. Cobrar os do passo inteiro ao executar uma
  // subtarefa faria "registrar protocolo" exigir o comprovante que só a conclusão do
  // passo pede — e a subtarefa nunca poderia ser feita na ordem certa.
  const pendentes = await requisitosPendentes({
    stepInstanceId,
    requisitos: (subtarefa ? subtarefa.requisitos : hist.passo.requisitos) ?? [],
    campos: camposDisponiveis,
    checklist: (subtarefa ? subtarefa.checkItens : hist.passo.checkItens) ?? [],
    canais: canaisDaVersao, valores, acaoKey: acao.key,
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
    case "REGISTER_PROTOCOL": detalhes = await registrarProtocoloDaEtapa(alvo); break
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

  // O PROTOCOLO QUE O EFEITO REGISTROU — lido do dono, para projetar sem copiar.
  const protocoloRegistrado = await (async () => {
    const id = (detalhes as { protocoloId?: unknown }).protocoloId
    if (typeof id !== "number") return null
    const p = await prisma.protocolo.findUnique({ where: { id }, select: { id: true, numeroProtocolo: true } })
    return p ? { id: p.id, numero: p.numeroProtocolo } : null
  })()

  // ── REGISTRO NA EXECUÇÃO DA SUBTAREFA ───────────────────────────────────
  //
  // Quando a ação é de uma subtarefa, é NELA que o que foi decidido fica. Guardar isso
  // na tentativa do passo devolveria o problema ao ponto de partida: três coisas
  // acontecendo dentro de um passo e um único lugar para registrar as três.
  if (subtarefa) {
    await garantirExecucao({
      stepInstanceId, subtaskKey: subtarefa.key, workflowVersao: hist.versao,
      status: ESTADOS_DA_SUBTAREFA.EM_ANDAMENTO,
    })
    // ── EXECUTAR UMA AÇÃO CONCLUI A SUBTAREFA ─────────────────────────────
    //
    // Concluir a SUBTAREFA e concluir o PASSO são perguntas diferentes. A primeira é
    // "o operador terminou o que esta subtarefa pedia?" — e escolher um resultado é
    // exatamente isso. Amarrá-la ao efeito do passo deixava "registrar o protocolo"
    // eternamente em andamento, porque o efeito dela é REGISTER_ONLY: a subtarefa
    // nunca ficaria pronta, e o passo que dependesse dela nunca concluiria.
    //
    // A exceção é a espera externa, que é um estado real e não uma conclusão: quem
    // manda a solicitação e fica aguardando o cartório não terminou nada ainda.
    //
    // Quando a subtarefa declara `condicaoConclusao`, é ela que decide — o cadastro
    // manda sobre o padrão.
    const esperandoTerceiro = def.key === "PAUSE_FOR_EXTERNAL_WAIT"
    const condicaoOk = avaliarCondicao(subtarefa.condicaoConclusao as Condicao | null, { valores })
    const estadoDaSubtarefa = esperandoTerceiro
      ? ESTADOS_DA_SUBTAREFA.AGUARDANDO_EXTERNO
      : condicaoOk
        ? ESTADOS_DA_SUBTAREFA.CONCLUIDO
        : ESTADOS_DA_SUBTAREFA.EM_ANDAMENTO
    await registrarNaExecucao(stepInstanceId, subtarefa.key, {
      status: estadoDaSubtarefa,
      resultado: acao.key,
      executadoPorId: ctx.usuarioId,
      startedAt: new Date(),
      payload: {
        acao: acao.key, efeito: acao.effectKey, versaoDaConfiguracao: hist.versao,
        valores, detalhes: {}, decididoEm: new Date().toISOString(),
      } as never,
      ...(typeof valores.canal === "string" ? { canalKey: valores.canal } : {}),
      // O PROTOCOLO VEM DO DONO, não do formulário.
      //
      // Antes, o número era copiado de `valores.numero_protocolo` direto para a coluna
      // de texto: a subtarefa virava uma terceira afirmação sobre o mesmo fato, ao lado
      // do payload e de `Protocolo`. Agora a coluna só recebe o que o cadastro canônico
      // confirmou, e o vínculo (`protocoloId`) é quem manda — o texto fica como projeção
      // para os leitores que ainda não migraram.
      ...(protocoloRegistrado
        ? { protocoloId: protocoloRegistrado.id, protocolo: protocoloRegistrado.numero }
        : {}),
      ...(ctx.fornecedorId ? { fornecedorId: ctx.fornecedorId } : {}),
    })
    // CONCLUIR A SUBTAREFA MUDA O ESTADO DAS QUE DEPENDIAM DELA. Sem reconciliar, elas
    // continuariam BLOQUEADO no banco enquanto a projeção já as considera disponíveis.
    const { reconciliarSubtarefas } = await import("@/src/services/subtarefas-da-etapa")
    await reconciliarSubtarefas({ stepInstanceId, valores, fornecedorId: ctx.fornecedorId ?? null })
  }

  // ── O QUE O EFEITO CONSUMIU SAI DA EXECUÇÃO ─────────────────────────────
  //
  // Depois que o protocolo virou linha em `Protocolo`, manter o número aqui seria a
  // segunda verdade: dois lugares editáveis para o mesmo fato. Fica a referência, que
  // o handler do efeito gravou, e o valor sai. Payload ANTIGO não é tocado — isto vale
  // para o que está sendo escrito agora.
  for (const k of def.camposConsumidos ?? []) delete valores[k]

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

  // ── QUEM CONCLUI O PASSO ────────────────────────────────────────────────
  //
  // Com a regra `ACAO_DO_PASSO` — o padrão e o que sempre valeu — quem conclui é a
  // ação: se ela declara `concluiPasso`, o passo fecha.
  //
  // Com uma regra baseada em subtarefas, quem conclui é a ÚLTIMA subtarefa
  // obrigatória a ficar pronta, seja qual for o efeito da ação que a fechou. Amarrar
  // a conclusão a uma ação específica deixaria o passo aberto para sempre no caso mais
  // comum: o operador conclui a última subtarefa com um "registrar" e o passo, que já
  // tinha tudo o que pedia, continuaria pendurado esperando um clique que ninguém sabe
  // que precisa dar.
  const gate = await passoPodeConcluir({ stepInstanceId, valores, fornecedorId: ctx.fornecedorId ?? null })
  const regraOlhaSubtarefas = gate.regra !== "ACAO_DO_PASSO"
  const deveConcluir = regraOlhaSubtarefas ? gate.pode : def.concluiPasso

  let concluiu = false
  if (def.concluiPasso && regraOlhaSubtarefas && !gate.pode) {
    // A AÇÃO FOI EXECUTADA E VALEU. O que não aconteceu foi a conclusão do passo — e
    // isso não é erro: é o estado real, com o nome do que falta. Recusar a ação inteira
    // desfaria uma subtarefa que o operador concluiu de verdade.
    return {
      ok: true, efeito: acao.effectKey, concluiuPasso: false,
      codigo: "SUBTAREFAS_PENDENTES",
      mensagem: `Registrado. A etapa ainda não conclui: ${gate.faltando.map((f) => `${f.label} (${f.motivo})`).join("; ")}`,
      detalhes: { regra: gate.regra, faltando: gate.faltando },
    }
  }
  if (deveConcluir) {
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
