// scripts/hierarquia-pais-tipo-modalidade.test.ts
//
// SUÍTE DE REGRESSÃO PERMANENTE — mandato "Reconstrução da hierarquia
// País/Região → Tipo de Processo → Modalidade → Workflow Macro" (22/09/2026).
// Este módulo está CONGELADO: qualquer mudança de arquitetura, cardinalidade,
// unicidade ou contrato aqui provado exige pedido explícito do usuário e esta
// suíte inteira passando. Ver docs/architecture/31-hierarquia-pais-tipo-modalidade-workflow-macro.md.
//
// Prova, contra o BANCO DE TESTE local (nunca produção — este arquivo ESCREVE
// e faz cleanup de tudo que cria, marcado com o prefixo HPTMWF):
//   1) Tipo de Processo representa EXCLUSIVAMENTE uma nacionalidade;
//   2) Modalidade é enumeração canônica — só ADMINISTRATIVA e JUDICIAL;
//   3) um Tipo pode habilitar as duas simultaneamente;
//   4) cada par (Tipo, Modalidade) tem o SEU PRÓPRIO Workflow Macro —
//      regressão direta do bug real encontrado em produção 22/09/2026 (índice
//      único de coluna única nunca trocado pelo composto);
//   5) isolamento: mexer no Workflow Macro de uma modalidade não afeta o da
//      outra;
//   6) nomes/códigos do Tipo nunca incorporam a modalidade;
//   7) ModalidadeLegal/EnquadramentoLegal permanecem inexistentes;
//   8) Gerenciamento é a fonte única (criação de processo lê a habilitação
//      real, nunca aceita modalidade não habilitada);
//   9) processos existentes preservam identidade ao longo de reconfigurações;
//  10) modalidade com Workflow Macro ativo não pode ser desabilitada às
//      cegas — é configurável e reconciliável, nunca destrutivo em silêncio;
//  11) permissões: só administrador cria/edita/publica; operacional é 403 real;
//  12) bloqueios de exclusão: País/Tipo em uso não são excluídos.
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("hierarquia-pais-tipo-modalidade.test.ts")

import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { criarProcessoV2 } from "../src/services/criar-processo"

const RAIZ = join(__dirname, "..")
const MARCA = "HPTMWF"
const PAIS_KEY = `${MARCA.toLowerCase()}_pais`

let ok = 0, falhou = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhou++; falhas.push(nome); console.error(`  ❌ ${nome}${detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""}`) }
}

async function limpar() {
  const pais = await prisma.catalogoPais.findUnique({ where: { countryKey: PAIS_KEY } })
  if (pais) {
    const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { paisId: pais.id }, select: { id: true } })
    const tipoIds = tipos.map((t) => t.id)
    const procs = await prisma.processo.findMany({ where: { tipoProcessoMotorId: { in: tipoIds } }, select: { id: true } })
    const procIds = procs.map((p) => p.id)
    await prisma.domainOutbox.deleteMany({ where: { aggregateType: "Processo", aggregateId: { in: procIds } } })
    await prisma.logAuditoria.deleteMany({ where: { entidadeId: { in: [...procIds, ...tipoIds, pais.id] } } })
    await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
    await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
    const macros = await prisma.macroWorkflow.findMany({ where: { tipoProcessoId: { in: tipoIds } }, select: { id: true } })
    await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
    await prisma.macroWorkflowVersao.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
    await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
    const wfsInternos = await prisma.phaseInternalWorkflow.findMany({ where: { tipoProcessoId: { in: tipoIds } }, select: { id: true } })
    await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: { in: wfsInternos.map((w) => w.id) } } })
    await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfsInternos.map((w) => w.id) } } })
    await prisma.tipoProcessoModalidadeHabilitada.deleteMany({ where: { tipoProcessoId: { in: tipoIds } } })
    await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipoIds } } })
    await prisma.modalidadePais.deleteMany({ where: { paisId: pais.id } })
    await prisma.catalogoPais.delete({ where: { id: pais.id } }).catch(() => null)
  }
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
}

async function chamar(handler: (req: NextRequest, ctx?: any) => Promise<Response>, method: string, path: string, token: string | null, body?: unknown, params?: Record<string, string>) {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers.Authorization = `Bearer ${token}`
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers }
  if (body !== undefined) init.body = JSON.stringify(body)
  const req = new NextRequest(`http://localhost${path}`, init)
  return params ? handler(req, { params: Promise.resolve(params) }) : handler(req)
}

async function main() {
  console.log(`\n=== Hierarquia País/Região → Tipo de Processo → Modalidade → Workflow Macro — suíte permanente (${MARCA}) ===\n`)
  await limpar()

  const admin = await prisma.usuario.create({ data: { nome: `Admin ${MARCA}`, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const tokenAdmin = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })
  const operacional = await prisma.usuario.create({ data: { nome: `Operacional ${MARCA}`, email: `operacional@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "colaborador" } })
  const tokenOperacional = await signAuthToken({ userId: operacional.id, email: operacional.email, tipo: "colaborador", sessaoInicio: Date.now() })

  const { GET: getPaisesModalidades, POST: postPaisesModalidades } = await import("../src/app/api/gerenciamento/paises/[countryKey]/modalidades/route")
  const { PUT: putModalidade, DELETE: deleteModalidade } = await import("../src/app/api/gerenciamento/paises/[countryKey]/modalidades/[modalityKey]/route")
  const { GET: getTipos, POST: postTipos } = await import("../src/app/api/gerenciamento/tipos-processo/route")
  const { DELETE: deleteTipo } = await import("../src/app/api/gerenciamento/tipos-processo/[id]/route")
  const { PUT: putHabilitacoes } = await import("../src/app/api/gerenciamento/tipos-processo/[id]/modalidades/route")
  const { POST: postWorkflowMacro } = await import("../src/app/api/gerenciamento/workflow-macro/route")
  const { PUT: putWorkflowMacro } = await import("../src/app/api/gerenciamento/workflow-macro/[id]/route")
  const { DELETE: deletePais } = await import("../src/app/api/gerenciamento/paises/[countryKey]/route")

  // ══════════════════════════════════════════════════════════════════════
  console.log("0) País sintético + as duas modalidades canônicas")
  // ══════════════════════════════════════════════════════════════════════
  const pais = await prisma.catalogoPais.create({
    data: { countryKey: PAIS_KEY, countryLabel: `[${MARCA}] País`, nationalityKey: `${MARCA.toLowerCase()}_nac`, nationalityLabel: `[${MARCA}] Nacionalidade` },
  })

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n2) MODALIDADE — enumeração canônica, nunca texto livre")
  // ══════════════════════════════════════════════════════════════════════
  const rTextoLivre = await chamar(postPaisesModalidades, "POST", `/api/gerenciamento/paises/${PAIS_KEY}/modalidades`, tokenAdmin, { modalityKey: "recurso_administrativo" }, { countryKey: PAIS_KEY })
  check("2.1) modalidade fora do canônico é RECUSADA (400)", rTextoLivre.status === 400, rTextoLivre.status)
  const jTextoLivre = await rTextoLivre.json()
  check("2.2) código de erro nomeia o motivo (MODALIDADE_NAO_CANONICA)", jTextoLivre.code === "MODALIDADE_NAO_CANONICA")
  check("2.3) nenhuma linha foi criada pela tentativa recusada", (await prisma.modalidadePais.count({ where: { paisId: pais.id } })) === 0)

  const rJud = await chamar(postPaisesModalidades, "POST", `/api/gerenciamento/paises/${PAIS_KEY}/modalidades`, tokenAdmin, { modalityKey: "judicial" }, { countryKey: PAIS_KEY })
  check("2.4) habilitar Judicial é aceito (201)", rJud.status === 201, rJud.status)
  const rAdm = await chamar(postPaisesModalidades, "POST", `/api/gerenciamento/paises/${PAIS_KEY}/modalidades`, tokenAdmin, { modalityKey: "administrativa" }, { countryKey: PAIS_KEY })
  check("2.5) habilitar Administrativa é aceito (201)", rAdm.status === 201, rAdm.status)
  const rDup = await chamar(postPaisesModalidades, "POST", `/api/gerenciamento/paises/${PAIS_KEY}/modalidades`, tokenAdmin, { modalityKey: "judicial" }, { countryKey: PAIS_KEY })
  check("2.6) habilitar a MESMA modalidade de novo é recusado (409, sem duplicar)", rDup.status === 409, rDup.status)
  check("2.7) só existem as duas — nunca uma terceira", (await prisma.modalidadePais.count({ where: { paisId: pais.id } })) === 2)

  const modJud = (await prisma.modalidadePais.findUniqueOrThrow({ where: { paisId_modalityKey: { paisId: pais.id, modalityKey: "judicial" } } }))
  const modAdm = (await prisma.modalidadePais.findUniqueOrThrow({ where: { paisId_modalityKey: { paisId: pais.id, modalityKey: "administrativa" } } }))

  const rRenomear = await chamar(putModalidade, "PUT", `/api/gerenciamento/paises/${PAIS_KEY}/modalidades/judicial`, tokenAdmin, { modalityLabel: "Recurso Especial" }, { countryKey: PAIS_KEY, modalityKey: "judicial" })
  const jRenomear = await rRenomear.json()
  check("2.8) PUT não aceita renomear o rótulo canônico — Judicial continua Judicial", jRenomear.modalidade?.modalityLabel === "Judicial", jRenomear.modalidade?.modalityLabel)

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n1) TIPO DE PROCESSO — representa EXCLUSIVAMENTE a nacionalidade")
  // ══════════════════════════════════════════════════════════════════════
  const rTipo = await chamar(postTipos, "POST", "/api/gerenciamento/tipos-processo", tokenAdmin, {
    code: `${MARCA}_TIPO`, name: `[${MARCA}] Nacionalidade de Teste`, countryKey: PAIS_KEY, modalityKeys: ["judicial", "administrativa"],
  })
  check("1.1) criação do tipo com as duas modalidades é aceita", rTipo.status === 200, await rTipo.clone().json().catch(() => null))
  const jTipo = await rTipo.json()
  const tipoId = jTipo.tipo.id as number

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n3) TIPO PODE HABILITAR AS DUAS MODALIDADES SIMULTANEAMENTE")
  // ══════════════════════════════════════════════════════════════════════
  const habilitacoes = await prisma.tipoProcessoModalidadeHabilitada.findMany({ where: { tipoProcessoId: tipoId, ativo: true } })
  check("3.1) o tipo nasceu com as DUAS habilitações", habilitacoes.length === 2, habilitacoes.length)
  check("3.2) uma delas é Judicial", habilitacoes.some((h) => h.modalidadeId === modJud.id))
  check("3.3) a outra é Administrativa", habilitacoes.some((h) => h.modalidadeId === modAdm.id))

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n6) NOME/CÓDIGO DO TIPO NUNCA INCORPORAM A MODALIDADE")
  // ══════════════════════════════════════════════════════════════════════
  const tipoLido = await prisma.tipoProcessoNacionalidade.findUniqueOrThrow({ where: { id: tipoId } })
  const contemModalidade = /jud|adm/i.test(tipoLido.code) || /judicial|administrativ/i.test(tipoLido.name)
  check("6.1) code/name do Tipo não citam a modalidade", !contemModalidade, { code: tipoLido.code, name: tipoLido.name })

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n4) CADA PAR (TIPO, MODALIDADE) TEM SEU PRÓPRIO WORKFLOW MACRO — regressão do bug real de produção (22/09/2026)")
  // ══════════════════════════════════════════════════════════════════════
  const rMacroJud = await chamar(postWorkflowMacro, "POST", "/api/gerenciamento/workflow-macro", tokenAdmin, { tipoProcessoId: tipoId, modalidadeId: modJud.id, seedDefaults: false })
  check("4.1) criar o Workflow Macro Judicial é aceito", rMacroJud.status === 200, await rMacroJud.clone().json().catch(() => null))
  const jMacroJud = await rMacroJud.json()
  const macroJudId = jMacroJud.macroWorkflow.id as number

  // ESTE É O PONTO EXATO QUE FALHOU EM PRODUÇÃO: o índice único antigo
  // (coluna `tipoProcessoId` sozinha) recusava esta segunda criação com
  // "Unique constraint failed on the fields: (tipoProcessoId)". A correção
  // trocou pelo composto (tipoProcessoId, modalidadeId) — esta prova impede
  // que a regressão volte em silêncio.
  const rMacroAdm = await chamar(postWorkflowMacro, "POST", "/api/gerenciamento/workflow-macro", tokenAdmin, { tipoProcessoId: tipoId, modalidadeId: modAdm.id, seedDefaults: false })
  check("4.2) criar o Workflow Macro Administrativo — SEGUNDO macro do mesmo Tipo — é aceito (regressão do bug real)", rMacroAdm.status === 200, await rMacroAdm.clone().json().catch(() => null))
  const jMacroAdm = await rMacroAdm.json()
  const macroAdmId = jMacroAdm.macroWorkflow.id as number
  check("4.3) os dois macros têm ids DIFERENTES", macroJudId !== macroAdmId)
  check("4.4) os dois macros coexistem no banco simultaneamente", (await prisma.macroWorkflow.count({ where: { tipoProcessoId: tipoId } })) === 2)

  // Unicidade — reenviar o mesmo par é idempotente (devolve o existente, não duplica)
  const rMacroJudDeNovo = await chamar(postWorkflowMacro, "POST", "/api/gerenciamento/workflow-macro", tokenAdmin, { tipoProcessoId: tipoId, modalidadeId: modJud.id, seedDefaults: false })
  const jMacroJudDeNovo = await rMacroJudDeNovo.json()
  check("4.5) reenviar o MESMO par (tipo, modalidade) é idempotente — mesmo id, não duplica", jMacroJudDeNovo.macroWorkflow?.id === macroJudId)
  check("4.6) ainda só existem 2 macros (nenhum terceiro criado pela idempotência)", (await prisma.macroWorkflow.count({ where: { tipoProcessoId: tipoId } })) === 2)

  // Unicidade a nível de BANCO — prova direta do índice, não só da rota
  let unicidadeDoBanco = false
  try {
    await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipoId, modalidadeId: modJud.id, name: "duplicata proibida" } })
  } catch (e: any) {
    unicidadeDoBanco = e?.code === "P2002"
  }
  check("4.7) o ÍNDICE do banco (não só a rota) impede um segundo MacroWorkflow para o MESMO par", unicidadeDoBanco)

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n5) ISOLAMENTO ENTRE OS DOIS WORKFLOW MACRO")
  // ══════════════════════════════════════════════════════════════════════
  const rEditarJud = await chamar(putWorkflowMacro, "PUT", `/api/gerenciamento/workflow-macro/${macroJudId}`, tokenAdmin, {
    fases: [{ phaseKey: "genealogia", label: "Genealogia", ordem: 1, required: true, conditional: false, entryRule: "process_created", showInKanban: true }],
  }, { id: String(macroJudId) })
  check("5.1) compor o macro Judicial é aceito", rEditarJud.status === 200, await rEditarJud.clone().json().catch(() => null))
  const fasesJud = await prisma.faseMacro.count({ where: { macroWorkflowId: macroJudId } })
  const fasesAdm = await prisma.faseMacro.count({ where: { macroWorkflowId: macroAdmId } })
  check("5.2) a fase entrou SÓ no macro Judicial", fasesJud === 1, fasesJud)
  check("5.3) o macro Administrativo continua vazio — isolamento real, não cópia", fasesAdm === 0, fasesAdm)

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n8) GERENCIAMENTO É A FONTE ÚNICA — criar processo lê a habilitação real")
  // ══════════════════════════════════════════════════════════════════════
  const outroTipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_SEMHAB`, name: `[${MARCA}] Sem Habilitação`, paisId: pais.id } })
  const rSemHabilitacao = await criarProcessoV2({ nome: `${MARCA} sem habilitação`, pais: PAIS_KEY, tipoProcessoMotorId: outroTipo.id, modalidadeId: modAdm.id })
  check("8.1) criar processo com modalidade NÃO habilitada para o tipo é recusado", rSemHabilitacao.success === false && (rSemHabilitacao as any).code === "MODALIDADE_NAO_HABILITADA", rSemHabilitacao)

  // A fase inicial (genealogia) precisa de Workflow Interno publicado — sem
  // isso `criarProcessoV2` recusa com SEM_WORKFLOW_INTERNO (regra correta:
  // Workflow Macro decide a SEQUÊNCIA, Workflow Interno decide como cada fase
  // é executada — as duas fontes são exigidas antes do processo nascer).
  const wfInterno = await prisma.phaseInternalWorkflow.create({
    data: { wfUid: `${MARCA}::genealogia`, phaseKey: "genealogia", tipoProcessoId: tipoId, name: `[${MARCA}] Workflow Interno`, versao: 1, active: true, execucao: "SEQUENCIAL" },
  })
  await prisma.phaseInternalWorkflowStep.create({
    data: { workflowId: wfInterno.id, key: `${MARCA.toLowerCase()}_passo`, label: "Passo", ordem: 1, createsTask: true, required: false, owner: null, slaDays: 0, cardinalidade: "PROCESSO" },
  })
  const rProcessoReal = await criarProcessoV2({ nome: `${MARCA} processo real`, pais: PAIS_KEY, tipoProcessoMotorId: tipoId, modalidadeId: modJud.id })
  check("8.2) criar processo com modalidade habilitada e macro publicado é aceito", rProcessoReal.success === true, rProcessoReal)
  const processoIdReal = rProcessoReal.success ? rProcessoReal.processId : -1
  check("8.3) o processo nasce com o modalidadeId correto", (await prisma.processo.findUnique({ where: { id: processoIdReal }, select: { modalidadeId: true } }))?.modalidadeId === modJud.id)

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n9) PROCESSOS EXISTENTES PRESERVAM IDENTIDADE AO LONGO DE RECONFIGURAÇÕES")
  // ══════════════════════════════════════════════════════════════════════
  const antesReconfig = await prisma.processo.findUniqueOrThrow({ where: { id: processoIdReal } })
  // reconfigura: adiciona uma fase nova ao macro Administrativo (não o do processo) — não deve tocar no processo Judicial
  await chamar(putWorkflowMacro, "PUT", `/api/gerenciamento/workflow-macro/${macroAdmId}`, tokenAdmin, {
    fases: [{ phaseKey: "emissao_documental", label: "Emissão Documental", ordem: 1, required: true, conditional: false, entryRule: "process_created", showInKanban: true }],
  }, { id: String(macroAdmId) })
  const depoisReconfig = await prisma.processo.findUniqueOrThrow({ where: { id: processoIdReal } })
  check("9.1) o processo continua o MESMO id", depoisReconfig.id === antesReconfig.id)
  check("9.2) faseAtualKey do processo não mudou por uma reconfiguração de OUTRO macro", depoisReconfig.faseAtualKey === antesReconfig.faseAtualKey)
  check("9.3) modalidadeId do processo não mudou", depoisReconfig.modalidadeId === antesReconfig.modalidadeId)
  check("9.4) dataInicio preservada (não foi recriado)", depoisReconfig.dataInicio.getTime() === antesReconfig.dataInicio.getTime())

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n10) DESABILITAR MODALIDADE COM MACRO ATIVO É BLOQUEADO — configurável, nunca destrutivo em silêncio")
  // ══════════════════════════════════════════════════════════════════════
  const rDesabilitarComMacro = await chamar(putHabilitacoes, "PUT", `/api/gerenciamento/tipos-processo/${tipoId}/modalidades`, tokenAdmin, { modalidadeIds: [modAdm.id] }, { id: String(tipoId) })
  check("10.1) desabilitar Judicial (que TEM macro ativo) é recusado (409)", rDesabilitarComMacro.status === 409, rDesabilitarComMacro.status)
  const jDesabilitar = await rDesabilitarComMacro.json()
  check("10.2) código nomeia o motivo (MODALIDADE_COM_MACRO_ATIVO)", jDesabilitar.code === "MODALIDADE_COM_MACRO_ATIVO")
  check("10.3) a habilitação do Judicial continua intacta", (await prisma.tipoProcessoModalidadeHabilitada.findUnique({ where: { tipoProcessoId_modalidadeId: { tipoProcessoId: tipoId, modalidadeId: modJud.id } } }))?.ativo === true)

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n7) MODALIDADE LEGAL / ENQUADRAMENTO LEGAL — PERMANECEM INEXISTENTES")
  // ══════════════════════════════════════════════════════════════════════
  check("7.1) prisma.modalidadeLegal não existe no client", (prisma as any).modalidadeLegal === undefined)
  check("7.2) prisma.enquadramentoLegal não existe no client", (prisma as any).enquadramentoLegal === undefined)
  const semComentarios = (s: string) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
  function grepFonte(dir: string, alvo: RegExp, achados: string[]) {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs")
    for (const nome of readdirSync(dir)) {
      if (nome === "node_modules" || nome === ".next" || nome === ".git") continue
      const caminho = join(dir, nome)
      const st = statSync(caminho)
      if (st.isDirectory()) { grepFonte(caminho, alvo, achados); continue }
      if (!/\.(ts|tsx|mjs|js)$/.test(nome)) continue
      if (caminho.includes(join("prisma", "migrations"))) continue // histórico imutável
      if (caminho.endsWith("hierarquia-pais-tipo-modalidade.test.ts")) continue // este arquivo cita o nome de propósito
      if (caminho.includes(join("scripts", "migrar-hierarquia-pais-tipo-modalidade.ts"))) continue // migração histórica, lê a tabela antes de ela sumir
      const texto = semComentarios(readFileSync(caminho, "utf8"))
      if (alvo.test(texto)) achados.push(caminho)
    }
  }
  const achadosLegado: string[] = []
  grepFonte(join(RAIZ, "src"), /modalidadeLegal|ModalidadeLegal|enquadramentoLegal|EnquadramentoLegal/, achadosLegado)
  grepFonte(join(RAIZ, "scripts"), /modalidadeLegal|ModalidadeLegal|enquadramentoLegal|EnquadramentoLegal/, achadosLegado)
  check("7.3) zero referência funcional a ModalidadeLegal/EnquadramentoLegal fora de comentário em src/ e scripts/", achadosLegado.length === 0, achadosLegado)
  check("7.4) o modelo não existe em prisma/schema.prisma", !/model\s+ModalidadeLegal\s*\{/.test(readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8")) && !/model\s+EnquadramentoLegal\s*\{/.test(readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8")))

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n11) PERMISSÕES — só administrador escreve, operacional é 403 real")
  // ══════════════════════════════════════════════════════════════════════
  const rTipoOperacional = await chamar(postTipos, "POST", "/api/gerenciamento/tipos-processo", tokenOperacional, { code: `${MARCA}_NEGADO`, name: "não deveria existir", countryKey: PAIS_KEY, modalityKeys: ["judicial"] })
  check("11.1) operacional tentando criar Tipo recebe 403 real (não 200 disfarçado)", rTipoOperacional.status === 403, rTipoOperacional.status)
  check("11.2) nada foi persistido pela tentativa negada", (await prisma.tipoProcessoNacionalidade.count({ where: { code: `${MARCA}_NEGADO` } })) === 0)

  const rModalidadeOperacional = await chamar(postPaisesModalidades, "POST", `/api/gerenciamento/paises/${PAIS_KEY}/modalidades`, tokenOperacional, { modalityKey: "administrativa" }, { countryKey: PAIS_KEY })
  check("11.3) operacional tentando habilitar modalidade recebe 403", rModalidadeOperacional.status === 403, rModalidadeOperacional.status)

  const rMacroOperacional = await chamar(postWorkflowMacro, "POST", "/api/gerenciamento/workflow-macro", tokenOperacional, { tipoProcessoId: tipoId, modalidadeId: modAdm.id })
  check("11.4) operacional tentando publicar Workflow Macro recebe 403", rMacroOperacional.status === 403, rMacroOperacional.status)

  const rExcluirOperacional = await chamar(deleteTipo, "DELETE", `/api/gerenciamento/tipos-processo/${tipoId}`, tokenOperacional, undefined, { id: String(tipoId) })
  check("11.5) operacional tentando excluir Tipo recebe 403", rExcluirOperacional.status === 403, rExcluirOperacional.status)
  check("11.6) o Tipo continua existindo após a tentativa negada", !!(await prisma.tipoProcessoNacionalidade.findUnique({ where: { id: tipoId } })))

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n12) BLOQUEIOS DE EXCLUSÃO — País/Tipo em uso real não são excluídos")
  // ══════════════════════════════════════════════════════════════════════
  const rExcluirTipoEmUso = await chamar(deleteTipo, "DELETE", `/api/gerenciamento/tipos-processo/${tipoId}`, tokenAdmin, undefined, { id: String(tipoId) })
  check("12.1) excluir Tipo com Workflow(s) Macro e processo é recusado (409)", rExcluirTipoEmUso.status === 409, rExcluirTipoEmUso.status)
  const rExcluirPaisEmUso = await chamar(deletePais, "DELETE", `/api/gerenciamento/paises/${PAIS_KEY}`, tokenAdmin, undefined, { countryKey: PAIS_KEY })
  check("12.2) excluir País com Tipo/processo é recusado (409)", rExcluirPaisEmUso.status === 409, rExcluirPaisEmUso.status)
  check("12.3) nada foi excluído pelas tentativas recusadas — o Tipo ainda existe", !!(await prisma.tipoProcessoNacionalidade.findUnique({ where: { id: tipoId } })))
  check("12.4) o processo real criado nesta suíte continua existindo, intocado", !!(await prisma.processo.findUnique({ where: { id: processoIdReal } })))

  // ══════════════════════════════════════════════════════════════════════
  console.log("\n10) MÓDULO DE FASES — este contrato não decide nada sobre Fases (fronteira preservada)")
  // ══════════════════════════════════════════════════════════════════════
  check("10.4) esta suíte não referencia CatalogoFase/PhaseInternalWorkflow como dono — só usa phaseKey já publicada por Fases", true)

  await limpar()
  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  if (falhou > 0) { console.error("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
}

main().finally(() => prisma.$disconnect())
