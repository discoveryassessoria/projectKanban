// scripts/sete-passos-operacionais.test.ts
//
// OS SETE PASSOS QUE A AUDITORIA ACUSOU DE NÃO TEREM COMO SER EXECUTADOS.
//
// Seis são da Retificação de Registros e estavam mesmo vazios: publicados, ativos,
// numa fase que já roda, e sem uma ação sequer. O sétimo — `localizar_registro`, da
// Genealogia — foi FALSO POSITIVO da própria auditoria, e metade deste arquivo existe
// para não deixar esse engano voltar.
//
// A conta que errou foi somar linhas de cadastro. Serve para o executor DECLARATIVO,
// que desenha exatamente o que estiver cadastrado; não serve para um executor
// ESPECIALIZADO, que traz o próprio formulário e por contrato não lê ações do cadastro.
// Cadastro vazio significa coisas opostas nos dois casos.
//
//   node scripts/mrg-banco-teste.mjs up
//   PRISMA_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/discovery_test \
//   npx tsx scripts/sete-passos-operacionais.test.ts

import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { PrismaClient, Prisma } from "@prisma/client"
import { CONFIGURACAO } from "./_configuracao-retificacao"
import { validarConfiguracao, executorEfetivo } from "../src/services/validacao-de-publicacao"
import { alvoDoCampo } from "../src/lib/motor/fontes-de-campo"
import { REGISTRO_DE_EXECUTORES } from "../src/lib/motor/registro-de-executores"
import { efeitosDaFase } from "../src/lib/motor/catalogo-de-efeitos"
import { publicarWorkflow, preverPublicacao } from "../src/services/publicacao-de-workflow"
import { definicaoHistoricaDoPasso } from "../src/services/versao-publicada"
import { executarAcaoCadastrada } from "../src/services/executar-acao-cadastrada"
import { garantirTentativa, tentativasDoPasso, MOTIVOS_DE_TENTATIVA } from "../src/services/execucao-do-passo"

const prisma = new PrismaClient()
const M = "SPO"
const FASE = "retificacao_registros"
const ROOT = join(__dirname, "..")
const read = (r: string) => (existsSync(join(ROOT, r)) ? readFileSync(join(ROOT, r), "utf8") : "")
const PERMS = ["tarefas.editar", "documentos.editar", "processos.editar", "workflow.concluirPasso"]

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: `${M} ` } }, select: { id: true } })
  for (const p of procs) {
    await prisma.stepExecution.deleteMany({ where: { stepInstance: { processoId: p.id } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: p.id } })
    await prisma.tarefa.deleteMany({ where: { processoId: p.id } })
    await prisma.protocolo.deleteMany({ where: { processoId: p.id } })
    await prisma.retificacaoPacoteDivergencia.deleteMany({ where: { pacote: { processoId: p.id } } })
    await prisma.retificacaoPacote.deleteMany({ where: { processoId: p.id } })
    await prisma.divergencia.deleteMany({ where: { analise: { processoId: p.id } } })
    await prisma.analiseDocumental.deleteMany({ where: { processoId: p.id } })
    await prisma.workflowEvento.deleteMany({ where: { processoId: p.id } })
    await prisma.processo.delete({ where: { id: p.id } }).catch(() => null)
  }
  // Este palco não cria Pessoa — quem tira pessoa da árvore é `pessoa-ciclo-vida.ts`,
  // e um teste não abre exceção a isso só para limpar o que não sujou.
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: `${M} ` } } })
  const wf = await prisma.phaseInternalWorkflow.findUnique({ where: { wfUid: `${M}::ret` }, select: { id: true } })
  if (wf) {
    await prisma.phaseInternalWorkflowVersao.deleteMany({ where: { workflowId: wf.id } })
    await prisma.phaseInternalWorkflow.delete({ where: { id: wf.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: `${M.toLowerCase()}_` } } })
}

/** Monta a fase da Retificação com EXATAMENTE o conteúdo que a produção recebeu. */
async function montarRetificacao(phaseKey: string) {
  const efeitos = [...efeitosDaFase(FASE, null), "REGISTER_PROTOCOL", "REGISTER_RETIFICATION_PLAN"]
  await prisma.catalogoFase.create({
    data: {
      phaseKey, label: "Retificação (espelho de teste)", escopo: "PROCESSO", ordemPadrao: 95,
      slaDiasPadrao: 30, efeitosPermitidos: efeitos as never,
    },
  })
  const chaves = Object.keys(CONFIGURACAO)
  const wf = await prisma.phaseInternalWorkflow.create({
    data: {
      wfUid: `${M}::ret`, phaseKey, name: "Retificação de Registros", versao: 1, execucao: "SEQUENCIAL",
      passos: {
        create: chaves.map((k, i) => ({
          key: k, label: k, ordem: i + 1, createsTask: true, required: true,
          executorKey: "padrao", dependeDe: CONFIGURACAO[k].dependeDe as never,
        })),
      },
    },
    select: { id: true, passos: { select: { id: true, key: true }, orderBy: { ordem: "asc" } } },
  })
  for (const p of wf.passos) {
    const c = CONFIGURACAO[p.key]
    for (const [i, campo] of c.campos.entries()) {
      const f = await prisma.stepField.create({
        data: {
          stepId: p.id, key: campo.key, label: campo.label, tipo: campo.tipo,
          obrigatorio: campo.obrigatorio ?? false, ajuda: campo.ajuda ?? null, ordem: i + 1,
          ...(campo.referencia ? { opcoes: { referencia: campo.referencia } as never } : {}),
          ...(campo.condicao ? { condicao: campo.condicao as never } : {}),
        },
        select: { id: true },
      })
      if (campo.opcoes?.length) {
        await prisma.stepFieldOption.createMany({
          data: campo.opcoes.map((o, j) => ({ fieldId: f.id, key: o.key, label: o.label, ordem: j + 1 })),
        })
      }
    }
    await prisma.stepAction.createMany({
      data: c.acoes.map((a, i) => ({
        stepId: p.id, key: a.key, label: a.label, effectKey: a.effectKey,
        descricao: a.descricao, requerCampos: (a.requerCampos ?? []) as never, ordem: i + 1,
      })) as Prisma.StepActionCreateManyInput[],
    })
    if (c.checkItens?.length) {
      await prisma.stepChecklistItem.createMany({
        data: c.checkItens.map((it, i) => ({
          stepId: p.id, key: it.key, label: it.label, obrigatorio: it.obrigatorio ?? true, ordem: i + 1,
        })) as Prisma.StepChecklistItemCreateManyInput[],
      })
    }
    if (c.requisitos?.length) {
      await prisma.stepRequirement.createMany({
        data: c.requisitos.map((r, i) => ({
          stepId: p.id, key: r.key, label: r.label, tipo: r.tipo,
          alvoKey: r.alvoKey ?? null, acaoKey: r.acaoKey ?? null, ordem: i + 1,
          ...(r.condicao ? { condicao: r.condicao as never } : {}),
        })) as Prisma.StepRequirementCreateManyInput[],
      })
    }
  }
  return wf
}

async function main() {
  await limpar()
  const phaseKey = `${M.toLowerCase()}_retificacao`

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§21 — GENEALOGIA: `localizar_registro` tem meio de execução próprio")
  // ════════════════════════════════════════════════════════════════════════
  const exec = executorEfetivo({ key: "localizar_registro", executorKey: null }, "genealogia")
  // (A) O passo resolve para um executor especializado, não para o painel declarativo.
  check("(A) `localizar_registro` resolve para o executor registral", exec === "registral", exec)

  const cap = REGISTRO_DE_EXECUTORES[exec as keyof typeof REGISTRO_DE_EXECUTORES]
  // (B) O contrato do executor DIZ que ele não lê ações do cadastro. É por isso que
  // cadastro vazio ali não é defeito — e é essa a linha que a auditoria não leu.
  check("(B) o contrato declara que ele NÃO consome ações cadastradas", cap?.acoesCadastradas === false)
  check("(C) e o contrato é declarado, não inferido pelo nome do passo", !!cap && typeof cap.acoesCadastradas === "boolean")

  const central = read("src/components/kanban/workflow/CentralDaEtapaDrawer.tsx")
  // (D) A Central monta o editor registral. Sem isto, o contrato seria letra morta.
  check("(D) a Central monta o editor registral para esse tipo",
    /kindDoEditor\(step\)\s*===\s*"registral"/.test(central) && central.includes("EditorRegistralModal"))

  const modal = read("src/components/kanban/workflow/EditorRegistralModal.tsx")
  // (E) O editor grava no Documento — a fonte canônica —, não num payload paralelo.
  check("(E) o editor registral grava no Documento canônico", /\/api\/documentos\//.test(modal))
  // (F) E conclui a etapa ao salvar: o operador tem como fechar o que abriu.
  check("(F) e conclui a etapa ao salvar com sucesso", /status:\s*"concluida"/.test(modal))
  // (G) Não há segunda fonte: o editor não escreve os 23 campos registrais no payload.
  check("(G) não duplica os dados registrais em StepExecution.payload",
    !/stepExecution|payload\s*:/.test(modal.split("\n").filter((l) => l.includes("/api/")).join("\n")))

  // (H..M) A verificação de saúde precisa CONCORDAR com o contrato.
  const saude = read("lib/saude/verificacoes/cadastro-execucao.ts")
  check("(H) a verificação consulta o executor efetivo, não a chave crua", saude.includes("executorEfetivo("))
  check("(I) e isenta quem não consome ações cadastradas", /acoesCadastradas\)\s*\{[^}]*especializados/.test(saude))
  check("(J) separa placeholder de fase que nunca rodou", saude.includes("rodaram.has"))
  check("(K) a fase que nunca rodou é medida por execução real, não por adivinhação",
    saude.includes("phaseWorkflowInstance.groupBy"))
  check("(L) e a métrica distingue os três casos", /placeholders/.test(saude) && /especializados/.test(saude) && /incompletos/.test(saude))
  // Dentro do BLOCO da CAD-012 — o arquivo tem outras verificações com `achados.push`,
  // e comparar posições no arquivo inteiro mediria a ordem errada.
  const blocoCad012 = saude.slice(saude.indexOf("CAD-012"))
  check("(M) o achado só é ERRO quando o executor é declarativo E a fase roda",
    blocoCad012.indexOf("if (cap && !cap.acoesCadastradas)") < blocoCad012.indexOf("achados.push") &&
    blocoCad012.indexOf("if (!rodaram.has") < blocoCad012.indexOf("achados.push"))

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§22 — RETIFICAÇÃO: os seis passos passam a ser executáveis")
  // ════════════════════════════════════════════════════════════════════════
  const wf = await montarRetificacao(phaseKey)
  const porChave = new Map(wf.passos.map((p) => [p.key, p.id]))
  check("(A) os seis passos existem", wf.passos.length === 6)

  const paraValidar = await prisma.phaseInternalWorkflowStep.findMany({
    where: { workflowId: wf.id },
    select: {
      key: true, label: true, executorKey: true, dependeDe: true,
      campos: { select: { key: true, tipo: true, obrigatorio: true, opcoes: true, opcoesCadastradas: { select: { key: true, ativo: true } } } },
      acoes: { select: { key: true, effectKey: true, requerCampos: true } },
      checkItens: { select: { key: true } },
      requisitos: { select: { key: true, tipo: true, alvoKey: true, acaoKey: true } },
    },
  })
  // O validador quer as opções COM identidade separadas da coluna JSON antiga —
  // sem isso ele não distingue "escolha sem opção" de "opções vindas de catálogo".
  const paraValidarNormalizado = paraValidar.map((p) => ({
    ...p,
    campos: p.campos.map((c) => ({ ...c, opcoes: c.opcoesCadastradas, opcoesLegado: c.opcoes })),
  }))
  const problemas = validarConfiguracao(paraValidarNormalizado as never, {
    phaseKey: FASE, efeitosPermitidosDaFase: [...efeitosDaFase(FASE, null), "REGISTER_PROTOCOL", "REGISTER_RETIFICATION_PLAN"],
  })
  // (B) O cadastro é publicável: nenhum efeito fora da competência da fase, nenhum
  // requisito órfão, nenhuma opção vazia.
  check("(B) o cadastro dos seis passa na validação de publicação", problemas.length === 0,
    JSON.stringify(problemas.slice(0, 3)))

  // (C) A fase NÃO decide retificação — isso é da Análise. O motor recusa por si.
  const efeitos = efeitosDaFase(FASE, null)
  check("(C) a fase não tem competência para decidir retificação", !efeitos.includes("GO_RETIFICATION"), efeitos.join(","))
  const usados = new Set(paraValidar.flatMap((p) => p.acoes.map((a) => a.effectKey)))
  const permitidos = [...efeitosDaFase(FASE, null), "REGISTER_PROTOCOL", "REGISTER_RETIFICATION_PLAN"]
  check("(D) e nenhuma ação cadastrada tenta um efeito fora da competência",
    [...usados].every((e) => permitidos.includes(e)), [...usados].join(","))

  // (E) A DEPENDÊNCIA É PRÉ-CONDIÇÃO, NÃO ORDEM. O grafo não é a corrente 1→2→3→4→5→6
  // que a numeração sugere: "redigir o pedido" não precisa do modo escolhido — o que
  // precisa dele é PROTOCOLAR, que tem de saber se o destinatário é tribunal ou
  // cartório. Gatear a redação era ordem visual disfarçada de pré-condição.
  const chaves = Object.keys(CONFIGURACAO)
  const dep = (k: string) => CONFIGURACAO[k].dependeDe
  check("(E) os dois primeiros passos abrem juntos — nenhum é pré-condição do outro",
    dep("definir_modo_de_retificacao").length === 0 && dep("preparar_requerimento_peticao").length === 0)
  check("(E2) protocolar exige as DUAS pré-condições reais: a peça e o modo",
    dep("protocolar_retificacao").length === 2 &&
    dep("protocolar_retificacao").includes("definir_modo_de_retificacao") &&
    dep("protocolar_retificacao").includes("preparar_requerimento_peticao"))
  check("(E3) e daí em diante cada passo depende do anterior, porque cada um é efeito dele",
    ["acompanhar_decisao", "registrar_averbacao", "validar_retificacao"].every((k, i) =>
      dep(k).length === 1 && dep(k)[0] === ["protocolar_retificacao", "acompanhar_decisao", "registrar_averbacao"][i]))
  check("(E4) nenhuma aresta é reflexiva ou aponta para passo inexistente",
    chaves.every((k) => dep(k).every((d) => d !== k && chaves.includes(d))))

  const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, versaoEsperada: 1 })
  check("(F) o cadastro publica", pub.ok && pub.versaoNova === 2, JSON.stringify(pub))

  // Um processo real percorrendo a fase.
  const arv = await prisma.arvore.create({ data: { nome: `${M} árvore` }, select: { id: true } })
  const proc = await prisma.processo.create({
    data: { nome: `${M} processo`, pais: "espanha", arvoreId: arv.id, workflowRuntime: "v2", faseAtualKey: phaseKey },
    select: { id: true },
  })
  // A UNIDADE É O PEDIDO. Este palco nasceu quando a fase materializava por PROCESSO;
  // com a cardinalidade RETIFICACAO, cada pedido tem a própria cadeia — e o passo que
  // define o modo grava NELE.
  const analise = await prisma.analiseDocumental.create({ data: { processoId: proc.id }, select: { id: true } })
  const div = await prisma.divergencia.create({
    data: { analiseId: analise.id, pessoaNome: `${M} P`, documentoTitulo: `${M} doc`, campo: "sobrenome",
      campoLabel: "Sobrenome", tipo: "nome", severidade: "media", status: "retificacao" },
    select: { id: true },
  })
  const { abrirPacoteDeRetificacao } = await import("../src/services/retificacao-canonica")
  const pacote = await abrirPacoteDeRetificacao({ processoId: proc.id, divergenciaIds: [div.id] })

  const inst = await prisma.phaseWorkflowInstance.create({
    data: {
      processoId: proc.id, faseMacroKey: phaseKey, ciclo: 1, status: "ATIVO",
      workflowDefinitionId: wf.id, workflowVersion: 2, chaveIdempotencia: `${M}-i1`,
    },
    select: { id: true },
  })
  const instancias = new Map<string, number>()
  for (const [i, k] of chaves.entries()) {
    const si = await prisma.phaseWorkflowStepInstance.create({
      data: {
        workflowInstanceId: inst.id, processoId: proc.id, faseMacroKey: phaseKey, ciclo: 1,
        stepKey: k, ordem: i + 1, tipo: "HUMANO", obrigatorio: true, geraTarefa: true,
        status: i === 0 ? "EM_ANDAMENTO" : "PENDENTE",
        dependeDeStepKeys: CONFIGURACAO[k].dependeDe as never,
        retificacaoPacoteId: pacote.pacoteId,
        stepDefinitionId: porChave.get(k)!, stepDefinitionVersion: 2, chaveIdempotencia: `${M}-p${i}`,
      },
      select: { id: true },
    })
    instancias.set(k, si.id)
  }
  const si1 = instancias.get("definir_modo_de_retificacao")!
  await garantirTentativa(si1, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })

  // (G) O operador abre a etapa e ENCONTRA o que fazer — era exatamente o que faltava.
  const hist = await definicaoHistoricaDoPasso(si1)
  check("(G) a etapa aberta traz ação e campo para o operador",
    (hist?.passo.acoes?.length ?? 0) > 0 && (hist?.passo.campos?.length ?? 0) > 0)

  // (H) O requisito é cobrado pelo servidor antes de concluir.
  const semModo = await executarAcaoCadastrada(si1, "modo_definido", {},
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-a0` })
  check("(H) concluir sem o modo escolhido é recusado", !semModo.ok, JSON.stringify(semModo))

  // (I) Só o vocabulário do domínio é aceito — `RetificacaoPacote.tipo`.
  const inventado = await executarAcaoCadastrada(si1, "modo_definido", { modo: "extrajudicial" },
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-a1` })
  check("(I) modo fora do vocabulário do domínio é recusado pelo SERVIDOR",
    !inventado.ok && inventado.codigo === "OPCAO_INVALIDA", JSON.stringify(inventado))

  // VIA ADMINISTRATIVA: não exige profissional nem número de processo — é a condição
  // declarada fazendo o que um `if` dentro do componente faria.
  const feito = await executarAcaoCadastrada(si1, "modo_definido", { modo: "administrativa" },
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-a2` })
  check("(J) com o modo do domínio, a etapa conclui", feito.ok, JSON.stringify(feito))

  check("(K) a escolha ficou gravada NO PEDIDO, que é o dono dela",
    (await prisma.retificacaoPacote.findUnique({ where: { id: pacote.pacoteId }, select: { tipo: true } }))?.tipo === "administrativa")
  const tent = (await tentativasDoPasso(si1)).find((t) => t.supersededAt == null)
  check("(K2) e NÃO ficou copiada dentro da execução",
    (tent?.payload as { valores?: Record<string, string> })?.valores?.modo === undefined)

  // (L) A espera é estado declarado, não etapa parada sem explicação.
  const si4 = instancias.get("acompanhar_decisao")!
  await prisma.phaseWorkflowStepInstance.update({ where: { id: si4 }, data: { status: "EM_ANDAMENTO" } })
  await garantirTentativa(si4, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
  const espera = await executarAcaoCadastrada(si4, "aguardando", {},
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-a3` })
  check("(L) 'aguardando decisão' pausa sem concluir a etapa",
    espera.ok && (await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: si4 }, select: { status: true } }))?.status !== "CONCLUIDO",
    JSON.stringify(espera))

  // (M) A exigência do órgão — estado que `RetificacaoPacote.status` já previa —
  // registra sem encerrar a espera.
  const exig = await executarAcaoCadastrada(si4, "exigencia_recebida", { situacao: "pediram certidão atualizada" },
    { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-a4` })
  check("(M) 'exigência recebida' registra sem encerrar a espera",
    exig.ok && (await prisma.phaseWorkflowStepInstance.findUnique({ where: { id: si4 }, select: { status: true } }))?.status !== "CONCLUIDO",
    JSON.stringify(exig))

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§23 — CONCORRÊNCIA: dois operadores na mesma etapa")
  // ════════════════════════════════════════════════════════════════════════
  const si2 = instancias.get("preparar_requerimento_peticao")!
  await prisma.phaseWorkflowStepInstance.update({ where: { id: si2 }, data: { status: "EM_ANDAMENTO" } })
  await garantirTentativa(si2, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })

  const simultaneas = await Promise.all([
    executarAcaoCadastrada(si2, "requerimento_pronto", { resumo_do_pedido: "corrigir grafia do sobrenome" },
      { usuarioId: 1, permissoes: PERMS, correlationId: `${M}-c1` }),
    executarAcaoCadastrada(si2, "requerimento_pronto", { resumo_do_pedido: "corrigir grafia do sobrenome" },
      { usuarioId: 2, permissoes: PERMS, correlationId: `${M}-c2` }),
  ])
  // Concluir duas vezes pode até responder ok duas vezes — o que NÃO pode é a etapa
  // ficar com duas tentativas vigentes ou concluir duas vezes de verdade.
  const vigentes = (await tentativasDoPasso(si2)).filter((t) => t.supersededAt == null)
  check("dois cliques simultâneos deixam UMA tentativa vigente", vigentes.length === 1,
    `${vigentes.length} vigentes; respostas=${simultaneas.map((r) => r.ok).join(",")}`)
  const evs = await prisma.workflowEvento.count({
    where: { processoId: proc.id, tipo: "PASSO_CONCLUIDO", stepInstanceId: si2 },
  })
  check("e a conclusão é contada uma vez só", evs <= 1, `${evs} eventos`)

  // ════════════════════════════════════════════════════════════════════════
  console.log("\n§24 — IDEMPOTÊNCIA: o mesmo comando repetido")
  // ════════════════════════════════════════════════════════════════════════
  const si3 = instancias.get("protocolar_retificacao")!
  await prisma.phaseWorkflowStepInstance.update({ where: { id: si3 }, data: { status: "EM_ANDAMENTO" } })
  await garantirTentativa(si3, { motivo: MOTIVOS_DE_TENTATIVA.ABERTURA, status: "DISPONIVEL" })
  const orgao = await prisma.orgaoProtocolo.create({
    data: { name: `${M} Cartório de Testes`, type: "cartorio", ativo: true }, select: { id: true },
  })
  const valores = { orgao_receptor: orgao.id, numero_protocolo: "RET-2026-77", data_protocolo: "2026-08-20" }
  const cid = `${M}-idem`
  const p1 = await executarAcaoCadastrada(si3, "protocolado", valores, { usuarioId: 1, permissoes: PERMS, correlationId: cid })
  const p2 = await executarAcaoCadastrada(si3, "protocolado", valores, { usuarioId: 1, permissoes: PERMS, correlationId: cid })
  check("o protocolo registra na primeira vez", p1.ok, JSON.stringify(p1))
  const vig3 = (await tentativasDoPasso(si3)).filter((t) => t.supersededAt == null)
  check("repetir o mesmo comando não cria segunda tentativa vigente", vig3.length === 1,
    `${vig3.length}; repetição=${JSON.stringify(p2.codigo ?? p2.ok)}`)
  // O NÚMERO NÃO ESTÁ MAIS NO PAYLOAD — está em `Protocolo`, que é o dono. A tentativa
  // guarda a referência, e é por ela que se chega ao número.
  const noPayload = (vig3[0]?.payload as { valores?: Record<string, string> })?.valores?.numero_protocolo
  check("o número do protocolo NÃO ficou copiado dentro da execução", noPayload === undefined, String(noPayload))
  const canonico = await prisma.protocolo.findFirst({
    where: { processoId: proc.id, origem: "ETAPA" },
    select: { id: true, numeroProtocolo: true, orgaoId: true },
  })
  check("ele está no cadastro de Protocolos, uma vez só",
    canonico?.numeroProtocolo === "RET-2026-77" &&
    (await prisma.protocolo.count({ where: { processoId: proc.id, origem: "ETAPA" } })) === 1,
    JSON.stringify(canonico))
  check("e a tentativa aponta para ele", vig3[0]?.protocoloId === canonico?.id,
    `${vig3[0]?.protocoloId} vs ${canonico?.id}`)

  // ════════════════════════════════════════════════════════════════════════
  console.log("\nO QUE NÃO FOI INVENTADO — as lacunas ficam visíveis, não preenchidas")
  // ════════════════════════════════════════════════════════════════════════
  // O ÓRGÃO TEM DONO: Órgãos e Organizações. Na primeira rodada não havia como
  // apontar para lá, e o campo ficou de fora — melhor ausente do que como texto livre,
  // que seria a segunda fonte que este trabalho existe para desfazer. Agora ele existe,
  // e a exigência mudou de "não crie" para "não crie COMO TEXTO".
  // A ENTIDADE é referência. O que está DENTRO dela pode ser texto — desde que o
  // modelo canônico também o guarde como texto, que é o caso de `Protocolo.setor`
  // ("setor/guichê dentro do órgão"). A distinção importa: "qual órgão" tem cadastro
  // e muda de nome; "qual vara dentro dele" não tem cadastro nenhum, e inventar um
  // seria criar estrutura para um dado que ninguém mantém.
  const todos = paraValidar.flatMap((p) => p.campos)
  // Classificar por SUBSTRING confundia "qual órgão" com "onde dentro do órgão":
  // `setor_do_orgao` contém "orgao" e não referencia entidade nenhuma. A pergunta é
  // sobre o campo que nomeia o DESTINATÁRIO.
  const destinatario = todos.find((c) => c.key === "orgao_receptor")
  check("o órgão destinatário existe como referência a cadastro, nunca como texto livre",
    destinatario?.tipo === "referencia" &&
    alvoDoCampo((destinatario as { opcoes?: unknown }).opcoes) === "ORGANIZACAO",
    `${destinatario?.key}:${destinatario?.tipo}`)
  check("a comarca NÃO virou campo — ela se lê do órgão referenciado",
    !todos.some((c) => /comarca/i.test(c.key)))
  check("a vara/setor é texto porque `Protocolo.setor` também é — e vai para lá",
    todos.some((c) => c.key === "setor_do_orgao" && c.tipo === "texto") &&
    /setor: texto\(a\.valores\.setor_do_orgao\)/.test(read("src/services/efeitos-de-dominio.ts")))
  check("nenhum campo de texto livre para entidade que tem cadastro próprio",
    todos.filter((c) => c.tipo === "texto")
      .every((c) => !/^(advogado|fornecedor|responsavel|orgao|cartorio|tribunal)$/i.test(c.key)))
  // O prazo do órgão é previsão de terceiro; o prazo da fase é do sistema.
  const ajudaPrazo = CONFIGURACAO.acompanhar_decisao.campos.find((c) => c.key === "prazo_informado")?.ajuda ?? ""
  check("o prazo informado pelo órgão se declara como previsão, não como prazo da fase",
    /não substitui/i.test(ajudaPrazo), ajudaPrazo)

  // ────────────────────────────────────────────────────────────────────────
  console.log(`\n${falhas.length === 0 ? "✅ PASSOU" : "❌ FALHOU"}: ${ok} ok, ${falhas.length} falhas`)
  if (falhas.length) { falhas.forEach((f) => console.log(`   · ${f}`)); process.exitCode = 1 }
  await limpar()
}

void main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
