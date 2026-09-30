// scripts/_fixture-arvore-fonte.ts
// ============================================================================
// FIXTURE COMPARTILHADA — "A ÁRVORE É A ÚNICA FONTE DE VERDADE DOCUMENTAL" (CLAUDE.md §37).
//
// Monta, no banco de TESTE, o cadastro documental mínimo e REAL (Natureza → Item →
// Tipo → Perfil com workflow → política da fase → Regras Documentais PUBLICADAS) e,
// sob demanda, cenários (árvore + processo + instância da Genealogia + pessoas).
// Os testes exercitam as ROTAS REAIS (PUT /api/pessoas/[id], /api/unioes, …) com
// token JWT de administrador — o mesmo caminho do usuário.
//
// Nada aqui é dado de produção. Tudo é marcado com MARCA e removido em `limpar()`.
// ============================================================================
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"

export interface Cenario {
  arvoreId: number
  processoId: number
  instanciaId: number
  titularId: number
  conjugeId: number | null
  avoId: number | null
}

export function criarPalco(MARCA: string) {
  const M = MARCA
  const TIPO_CODE = "TST-" + M.replace(/[^A-Z0-9]/gi, "").slice(0, 30)
  const COD = { NAS: `${M}-NAS`, CAS: `${M}-CAS`, OBI: `${M}-OBI`, REQ: `${M}-REQ` }
  const RULE = { NAS: `${M}_R_NAS`, CAS: `${M}_R_CAS`, OBI: `${M}_R_OBI`, REQ: `${M}_R_REQ` }
  let tipoId = 0
  let modalidadeId = 0
  let adminId = 0
  let token = ""
  const regraIds: Record<keyof typeof COD, number> = { NAS: 0, CAS: 0, OBI: 0, REQ: 0 }
  let seq = 0

  async function limpar() {
    const procs = await prisma.processo.findMany({ where: { nome: { startsWith: M } }, select: { id: true, arvoreId: true } })
    const ids = procs.map((p) => p.id)
    const arvIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "trg_${M}_bloqueia" ON "NecessidadeDocumental"`).catch(() => null)
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "fn_${M}_bloqueia"()`).catch(() => null)
    const tarefaIds = (await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })).map((t) => t.id)
    await prisma.logAuditoria.deleteMany({ where: { OR: [{ entidade: "Tarefa", entidadeId: { in: [0, ...tarefaIds] } }, { descricao: { contains: M } }] } })
    await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.necessidadeDocumentalEvento.deleteMany({ where: { necessidade: { processoId: { in: ids } } } })
    await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: { in: arvIds } } } })
    await prisma.necessidadeDocumental.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.processoRequerente.deleteMany({ where: { processoId: { in: ids } } })
    await prisma.processo.deleteMany({ where: { id: { in: ids } } })
    await prisma.requerente.deleteMany({ where: { nome: { startsWith: M } } })
    await prisma.uniao.deleteMany({ where: { OR: [{ pessoa1: { arvoreId: { in: arvIds } } }, { pessoa2: { arvoreId: { in: arvIds } } }] } })
    await prisma.pessoa.updateMany({ where: { arvoreId: { in: arvIds } }, data: { paiId: null, maeId: null } })
    await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvIds } } })
    await prisma.arvore.deleteMany({ where: { nome: { startsWith: M } } })
    await prisma.matrizDocumental.deleteMany({ where: { codigo: { startsWith: M } } })
    await prisma.tipoDocumentoCadastro.deleteMany({ where: { code: { startsWith: M } } })
    await prisma.perfilOperacionalDocumento.deleteMany({ where: { code: { startsWith: M } } })
    await prisma.faseMacro.deleteMany({ where: { macroWorkflow: { name: { startsWith: M } } } })
    await prisma.macroWorkflow.deleteMany({ where: { name: { startsWith: M } } })
    await prisma.phaseInternalWorkflow.deleteMany({ where: { wfUid: { startsWith: M } } })
    await prisma.itemCatalogo.deleteMany({ where: { code: { startsWith: M } } })
    await prisma.faseNaturezaPermitida.deleteMany({ where: { naturezaOperacional: { code: { startsWith: M } } } })
    await prisma.naturezaOperacionalDocumento.deleteMany({ where: { code: { startsWith: M } } })
    await prisma.tipoProcessoModalidadeHabilitada.deleteMany({ where: { tipoProcesso: { code: TIPO_CODE } } })
    await prisma.tipoProcessoNacionalidade.deleteMany({ where: { code: TIPO_CODE } })
    await prisma.usuario.deleteMany({ where: { email: { startsWith: M.toLowerCase() } } })
  }

  async function montar() {
    await limpar()
    await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
    const modalidade = await prisma.modalidadePais.findFirstOrThrow({ where: { ativo: true }, orderBy: { id: "asc" } })
    const tipo = await prisma.tipoProcessoNacionalidade.create({
      data: { code: TIPO_CODE, name: `${M} tipo`, paisId: modalidade.paisId, processFamily: "cidadania", serviceNature: "main_process" },
      select: { id: true },
    })
    tipoId = tipo.id
    await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: modalidade.id, ativo: true } })
    modalidadeId = modalidade.id

    const admin = await prisma.usuario.create({ data: { nome: `${M} Marco Rovatti`, email: `${M.toLowerCase()}-admin@arv.test`, senha: "x", tipo: "admin" }, select: { id: true, email: true } })
    adminId = admin.id
    token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })

    // CADASTRO DOCUMENTAL COMPLETO: natureza → itens → perfil (com workflow) → tipos → política da fase → regras.
    const natureza = await prisma.naturezaOperacionalDocumento.create({ data: { code: `${M}_CERT`, name: `${M} Certidão`, exigeWorkflow: true } })
    const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${M}-wf-perfil`, phaseKey: "emissao_documental", name: `${M} wf perfil`, active: true } })
    const perfil = await prisma.perfilOperacionalDocumento.create({ data: { code: `${M}_PERFIL`, name: `${M} perfil`, workflowId: wf.id, ativo: true } })
    const nomes: Record<keyof typeof COD, string> = { NAS: "Certidão de nascimento", CAS: "Certidão de casamento", OBI: "Certidão de óbito", REQ: "Certidão do requerente" }
    for (const k of Object.keys(COD) as (keyof typeof COD)[]) {
      const item = await prisma.itemCatalogo.create({ data: { code: `${M}_${k}`, name: nomes[k], natureza: "DOCUMENTO" } })
      await prisma.tipoDocumentoCadastro.create({
        data: { code: COD[k], name: nomes[k], itemCatalogoId: item.id, nature: "certidao", naturezaOperacionalId: natureza.id, perfilOperacionalId: perfil.id },
      })
    }
    const fase = await prisma.catalogoFase.upsert({ where: { phaseKey: "genealogia" }, update: {}, create: { phaseKey: "genealogia", label: "Genealogia" } })
    await prisma.faseNaturezaPermitida.upsert({
      where: { catalogoFaseId_naturezaOperacionalId: { catalogoFaseId: fase.id, naturezaOperacionalId: natureza.id } },
      update: { ativo: true }, create: { catalogoFaseId: fase.id, naturezaOperacionalId: natureza.id, ativo: true },
    })

    const regra = async (k: keyof typeof COD, extra: Record<string, unknown>) => {
      const r = await prisma.matrizDocumental.create({
        data: {
          tipoProcessoId: tipo.id, aplicaTodosProcessos: true, documentTypeCode: COD[k], documentosAceitos: [COD[k]],
          codigo: RULE[k], nome: `${M} ${nomes[k]}`, requisitoNome: nomes[k], status: "PUBLICADA", arquivado: false,
          faseExigencia: "genealogia", obrigatoriedade: "OBRIGATORIA", ...extra,
        },
        select: { id: true },
      })
      regraIds[k] = r.id
    }
    // nascimento: toda pessoa da LINHA RETA
    await regra("NAS", { publicoAlvo: "PESSOA_DA_LINHA_RETA", publicosAlvo: ["PESSOA_DA_LINHA_RETA"] })
    // casamento: por UNIÃO, quando a pessoa da linha reta é casada
    await regra("CAS", {
      publicoAlvo: "PESSOA_DA_LINHA_RETA", publicosAlvo: ["PESSOA_DA_LINHA_RETA"], alvoNecessidade: "UNIAO",
      condicoes: { combinador: "TODAS", regras: [{ campo: "casado", operador: "igual", valor: true }] },
    })
    // óbito: pessoa da linha reta falecida
    await regra("OBI", {
      publicoAlvo: "PESSOA_DA_LINHA_RETA", publicosAlvo: ["PESSOA_DA_LINHA_RETA"],
      condicoes: { combinador: "TODAS", regras: [{ campo: "falecido", operador: "igual", valor: true }] },
    })
    // certidão exigida SÓ do requerente
    await regra("REQ", { publicoAlvo: "REQUERENTE", publicosAlvo: ["REQUERENTE"] })
  }

  /** Árvore + processo + instância ATIVA da Genealogia + titular (linha reta, requerente "maior"). */
  async function novoCenario(nome: string, o: { conjuge?: boolean; avo?: boolean; titularRequerente?: boolean } = {}): Promise<Cenario> {
    seq++
    const rotulo = `${M} ${nome} ${seq}`
    const arv = await prisma.arvore.create({ data: { nome: rotulo }, select: { id: true } })
    const proc = await prisma.processo.create({
      data: { nome: rotulo, arvoreId: arv.id, tipoProcessoMotorId: tipoId, modalidadeId, faseAtualKey: "genealogia", workflowRuntime: "v2" },
      select: { id: true },
    })
    const inst = await prisma.phaseWorkflowInstance.create({
      data: { processoId: proc.id, faseMacroKey: "genealogia", ciclo: 1, status: "ATIVO", chaveIdempotencia: `${M}-inst-${proc.id}` },
      select: { id: true },
    })
    let avoId: number | null = null
    if (o.avo) {
      avoId = (await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Avo", sobrenome: `${M}-${nome}${seq}`, linhaReta: true, requerente: "nao", vivo: false }, select: { id: true } })).id
    }
    const titular = await prisma.pessoa.create({
      data: {
        arvoreId: arv.id, nome: "Edison", sobrenome: `${M}-${nome}${seq}`, linhaReta: true,
        requerente: o.titularRequerente === false ? "nao" : "maior", documentacao: true, vivo: true, casado: false, paiId: avoId,
      },
      select: { id: true },
    })
    let conjugeId: number | null = null
    if (o.conjuge) {
      conjugeId = (await prisma.pessoa.create({ data: { arvoreId: arv.id, nome: "Luana", sobrenome: `${M}-${nome}${seq}`, linhaReta: false, requerente: "nao", documentacao: true, casado: false }, select: { id: true } })).id
    }
    return { arvoreId: arv.id, processoId: proc.id, instanciaId: inst.id, titularId: titular.id, conjugeId, avoId }
  }

  /**
   * EMISSÃO DOCUMENTAL publicada: workflow com UM passo por DOCUMENTO (cardinalidade DOCUMENTO),
   * para provar que abrir a fase só gera passo/tarefa a partir de NECESSIDADE ativa.
   */
  async function montarEmissao() {
    const { publicarWorkflow } = await import("../src/services/publicacao-de-workflow")
    await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
    const macro = await prisma.macroWorkflow.upsert({
      where: { tipoProcessoId_modalidadeId: { tipoProcessoId: tipoId, modalidadeId } },
      update: {}, create: { tipoProcessoId: tipoId, modalidadeId, name: `${M} macro` }, select: { id: true },
    })
    await prisma.faseMacro.upsert({
      where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: "emissao_documental" } },
      update: {}, create: { macroWorkflowId: macro.id, phaseKey: "emissao_documental", label: "Emissão Documental", ordem: 2 },
    })
    const wf = await prisma.phaseInternalWorkflow.create({
      data: { wfUid: `${M}-emissao`, phaseKey: "emissao_documental", name: `${M} emissão`, active: true, tipoProcessoId: tipoId, escopoExecucao: "DOCUMENTO", exigeDocumento: true },
      select: { id: true },
    })
    const step = await prisma.phaseInternalWorkflowStep.create({
      data: { workflowId: wf.id, key: "solicitar_certidao", label: `${M} Solicitar certidão`, ordem: 1, slaDays: 5, cardinalidade: "DOCUMENTO", diasParaIniciar: 2, diasAposCobranca: 1, escalarApos: 2 },
      select: { id: true },
    })
    const sub = await prisma.stepSubtaskDefinition.create({ data: { stepId: step.id, key: "enviar_requerimento", label: "Enviar requerimento", ordem: 0, esperaExternaAoLiberar: false, dependeDe: [] }, select: { id: true } })
    await prisma.stepAction.create({ data: { stepId: step.id, subtaskId: sub.id, key: "concluir", label: "Concluir", ordem: 1, effectKey: "COMPLETE_STEP" } })
    const pub = await publicarWorkflow({ workflowId: wf.id, actorId: null, pularCompetenciaDeEfeito: true })
    if (!pub.ok) throw new Error(`publicação da Emissão falhou: ${JSON.stringify(pub).slice(0, 300)}`)
    return { workflowId: wf.id }
  }

  /**
   * MACROFLUXO DE DUAS FASES (Genealogia ordem 0 → Emissão Documental ordem 1) para o tipo/modalidade do palco,
   * com CatalogoFase ativas e a Emissão publicada (`montarEmissao`). É o mínimo que o `advance` aceita para o
   * processo SAIR da Genealogia de verdade (Processo.faseAtualKey muda + PhaseAdvanceLog AVANCADO).
   * Chame DEPOIS de `montar()` e ANTES de `novoCenario()`. Idempotente no mesmo palco.
   */
  async function montarMacroDuasFases() {
    await prisma.catalogoFase.upsert({ where: { phaseKey: "genealogia" }, update: {}, create: { phaseKey: "genealogia", label: "Genealogia" } })
    await prisma.catalogoFase.upsert({ where: { phaseKey: "emissao_documental" }, update: {}, create: { phaseKey: "emissao_documental", label: "Emissão Documental" } })
    const macro = await prisma.macroWorkflow.upsert({
      where: { tipoProcessoId_modalidadeId: { tipoProcessoId: tipoId, modalidadeId } },
      update: {}, create: { tipoProcessoId: tipoId, modalidadeId, name: `${M} macro` }, select: { id: true },
    })
    await prisma.faseMacro.upsert({
      where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: "genealogia" } },
      update: { ordem: 0 }, create: { macroWorkflowId: macro.id, phaseKey: "genealogia", label: "Genealogia", ordem: 0 },
    })
    await prisma.faseMacro.upsert({
      where: { macroWorkflowId_phaseKey: { macroWorkflowId: macro.id, phaseKey: "emissao_documental" } },
      update: { ordem: 1 }, create: { macroWorkflowId: macro.id, phaseKey: "emissao_documental", label: "Emissão Documental", ordem: 1 },
    })
    return montarEmissao()
  }

  // ── chamadas às ROTAS REAIS ────────────────────────────────────────────────
  const req = (url: string, method: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) })

  async function putPessoa(id: number, body: Record<string, unknown>) {
    const { PUT } = await import("../src/app/api/pessoas/[id]/route")
    return PUT(req(`/api/pessoas/${id}`, "PUT", body), ctx(id))
  }
  async function postPessoa(body: Record<string, unknown>) {
    const { POST } = await import("../src/app/api/pessoas/route")
    return POST(req(`/api/pessoas`, "POST", body))
  }
  async function deletePessoa(id: number, modo: "HARD" | "DESATIVAR" | "AUTO" = "AUTO") {
    const { DELETE } = await import("../src/app/api/pessoas/[id]/route")
    return DELETE(req(`/api/pessoas/${id}?modo=${modo}`, "DELETE"), ctx(id))
  }
  async function postUniao(pessoa1Id: number, pessoa2Id: number) {
    const { POST } = await import("../src/app/api/unioes/route")
    return POST(req(`/api/unioes`, "POST", { pessoa1Id, pessoa2Id, tipo: "casamento_civil" }))
  }
  async function deleteUniao(id: number) {
    const { DELETE } = await import("../src/app/api/unioes/[id]/route")
    return DELETE(req(`/api/unioes/${id}`, "DELETE"), ctx(id))
  }
  async function postRegra(id: number, acao: string) {
    const { POST } = await import("../src/app/api/gerenciamento/regras-documentais/[id]/route")
    return POST(req(`/api/gerenciamento/regras-documentais/${id}`, "POST", { acao }), ctx(id))
  }
  async function putMatrizLegada(id: number, body: Record<string, unknown>) {
    const { PUT } = await import("../src/app/api/gerenciamento/matriz-documental/[id]/route")
    return PUT(req(`/api/gerenciamento/matriz-documental/${id}`, "PUT", body), ctx(id))
  }
  async function postVincularRequerente(arvoreId: number, body: Record<string, unknown>) {
    const { POST } = await import("../src/app/api/arvore/[arvoreid]/vincular-requerente/route")
    return POST(req(`/api/arvore/${arvoreId}/vincular-requerente`, "POST", body), { params: Promise.resolve({ arvoreid: String(arvoreId) }) })
  }
  async function postDesvincularRequerente(arvoreId: number, pessoaId: number) {
    const { POST } = await import("../src/app/api/arvore/[arvoreid]/desvincular-requerente/route")
    return POST(req(`/api/arvore/${arvoreId}/desvincular-requerente`, "POST", { pessoaId }), { params: Promise.resolve({ arvoreid: String(arvoreId) }) })
  }

  // ── FOTOGRAFIA do que derivou da árvore (as quatro camadas) ────────────────
  async function foto(processoId: number) {
    const necs = await prisma.necessidadeDocumental.findMany({
      where: { processoId }, orderBy: { id: "asc" },
      select: { id: true, status: true, pessoaId: true, uniaoId: true, itemCatalogo: { select: { code: true } } },
    })
    const necIds = necs.map((n) => n.id)
    const docs = await prisma.documento.findMany({
      where: { OR: [{ necessidadeId: { in: necIds } }, { pessoa: { arvore: { processos: { some: { id: processoId } } } } }] },
      orderBy: { id: "asc" }, select: { id: true, status: true, necessidadeId: true, pessoaId: true, origem: true },
    })
    const passos = await prisma.phaseWorkflowStepInstance.findMany({
      where: { processoId }, orderBy: { id: "asc" }, select: { id: true, status: true, necessidadeId: true, documentoId: true, stepKey: true },
    })
    const tarefas = await prisma.tarefa.findMany({
      where: { processoId }, orderBy: { id: "asc" },
      select: { id: true, statusTarefa: true, necessidadeId: true, documentoId: true, titulo: true, causaRemovidaEm: true, causaRemovidaMotivo: true, responsavelId: true },
    })
    const cod = (n: { itemCatalogo: { code: string } | null }) => (n.itemCatalogo?.code ?? "").replace(`${M}_`, "")
    return {
      necs: necs.map((n) => ({ ...n, cod: cod(n) })),
      docs, passos, tarefas,
      necDe: (codigo: string, filtro: { pessoaId?: number; uniaoId?: number } = {}) =>
        necs.filter((n) => cod(n) === codigo && (filtro.pessoaId == null || n.pessoaId === filtro.pessoaId) && (filtro.uniaoId == null || n.uniaoId === filtro.uniaoId)),
    }
  }

  /** As quatro camadas de UMA necessidade, de uma vez. */
  async function derivados(necId: number) {
    const nec = await prisma.necessidadeDocumental.findUnique({ where: { id: necId }, select: { status: true } })
    const docs = await prisma.documento.findMany({ where: { necessidadeId: necId }, select: { id: true, status: true } })
    const passos = await prisma.phaseWorkflowStepInstance.findMany({ where: { necessidadeId: necId }, select: { id: true, status: true } })
    const tarefas = await prisma.tarefa.findMany({ where: { necessidadeId: necId }, select: { id: true, statusTarefa: true, causaRemovidaMotivo: true } })
    return {
      status: nec?.status ?? null, docs,
      passosVivos: passos.filter((p) => !PASSO_FECHADO.includes(p.status)).length,
      tarefasAbertas: tarefas.filter((t) => !TAREFA_FECHADA.includes(t.statusTarefa)).length,
      tarefas,
    }
  }

  const TAREFA_FECHADA = ["CONCLUIDO_RECEBIDO", "CONCLUIDO_NAO_POSSUI", "CANCELADA", "SUPERSEDIDA"]
  const PASSO_FECHADO = ["CONCLUIDO", "SUPERSEDIDO", "CANCELADO", "DISPENSADO"]
  const DOC_INATIVO = ["CANCELADO", "NAO_EXIGIDO"]

  return {
    M, COD, RULE, regraIds, limpar, montar, montarEmissao, montarMacroDuasFases, novoCenario,
    get adminId() { return adminId }, get token() { return token }, get tipoId() { return tipoId },
    putPessoa, postPessoa, deletePessoa, postUniao, deleteUniao, postRegra, putMatrizLegada,
    postVincularRequerente, postDesvincularRequerente, foto, derivados, req, ctx,
    TAREFA_FECHADA, PASSO_FECHADO, DOC_INATIVO,
  }
}
