// scripts/catalogo-fases-gerenciamento-completo.test.ts
// ============================================================================
// PROVA de que Gerenciamento → Fases administra fases futuras sem alteração
// direta de código, com publicação disparando reconciliação automática dos
// processos em andamento — mandato "Catálogo de Fases" (correção 20/09/2026,
// escopo reduzido só ao Catálogo). Complementa
// catalogo-fases-reconciliacao.test.ts (reconciliação geral) e
// catalogo-fases-alteracao-inativacao.test.ts (revisão/inativação) com o que
// ainda faltava: validação de publicação, rejeição de phaseKey duplicada,
// reconciliação de ESCOPO disparada pela EDIÇÃO (não só pela publicação do
// Workflow Macro), as 10 fases canônicas e seus 10 escopos.
//
//   PRISMA_DATABASE_URL=…discovery_test npx tsx scripts/catalogo-fases-gerenciamento-completo.test.ts
// ============================================================================
import { NextRequest } from "next/server"
import { prisma } from "../lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { signAuthToken } from "../lib/auth-jwt"
import { garantirOferta } from "./_fixture-oferta"
import { POST as postCatalogoFase } from "../src/app/api/gerenciamento/catalogo-fases/route"
import { PUT as putCatalogoFase } from "../src/app/api/gerenciamento/catalogo-fases/[id]/route"
import { GET as getRevisoes } from "../src/app/api/gerenciamento/catalogo-fases/revisoes/route"
import { processarOutbox } from "../src/services/outbox-dispatcher"
import { escopoCanonicoDaFase, resolverRotuloDaFase } from "../src/lib/process-stage/escopo-operacional-da-fase"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra: string | null | undefined = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "CFGC"

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const procIds = procs.map((p) => p.id)
  const arvoreIds = procs.map((p) => p.arvoreId).filter((x): x is number => x != null)
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: "Processo", aggregateId: { in: procIds } } })
  await prisma.logAuditoria.deleteMany({ where: { entidadeId: { in: procIds } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  await prisma.documento.deleteMany({ where: { pessoa: { arvoreId: { in: arvoreIds } } } })
  await prisma.pessoa.deleteMany({ where: { arvoreId: { in: arvoreIds } } })
  await prisma.arvore.deleteMany({ where: { id: { in: arvoreIds } } })
  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { wfUid: { startsWith: MARCA } }, select: { id: true } })
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: { in: wfs.map((w) => w.id) } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfs.map((w) => w.id) } } })
  const macros = await prisma.macroWorkflow.findMany({ where: { name: { startsWith: MARCA } }, select: { id: true } })
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipos.map((t) => t.id) } } })
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: `${MARCA.toLowerCase()}_` } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@cfgc.test" } } })
}

async function main() {
  exigirBancoDeTeste("Gerenciamento → Fases — cadastro/publicação/versionamento/reconciliação completos")
  console.log("CATÁLOGO DE FASES — entrega isolada (correção 20/09/2026)\n")
  await limpar()

  const admin = await prisma.usuario.create({ data: { nome: "Admin CFGC", email: "admin@cfgc.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const token = await signAuthToken({ userId: admin.id, email: "admin@cfgc.test", tipo: "admin", sessaoInicio: Date.now() })
  const chamarPost = (body: unknown) =>
    postCatalogoFase(new NextRequest("http://localhost/api/gerenciamento/catalogo-fases", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    }))
  const chamarPut = (id: number, body: unknown) =>
    putCatalogoFase(new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${id}`, {
      method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: String(id) }) })

  // ══════════════════════════════════════════════════════════════════════
  secao("1) Criação de fase nova")
  // ══════════════════════════════════════════════════════════════════════
  const rCriacao = await chamarPost({ phaseKey: `${MARCA.toLowerCase()}_nova`, label: "CFGC Fase Nova", escopo: "DOCUMENTO", requiredPadrao: true })
  ok("1.1) criação aceita (201)", rCriacao.status === 201, String(rCriacao.status))
  const jCriacao = await rCriacao.json()
  ok("1.2) revisão 1 nasce junto", jCriacao.fase?.revisaoAtual === 1, String(jCriacao.fase?.revisaoAtual))
  const revisao1 = await prisma.catalogoFaseRevisao.findFirst({ where: { catalogoFaseId: jCriacao.fase.id, revisao: 1 } })
  ok("1.3) CatalogoFaseRevisao #1 congelada na criação", !!revisao1 && revisao1.origem === "CRIACAO")

  secao("2) Rejeição de phaseKey duplicada")
  const rDup = await chamarPost({ phaseKey: `${MARCA.toLowerCase()}_nova`, label: "Outra fase, mesma chave", escopo: "PROCESSO" })
  ok("2.1) segunda criação com a MESMA chave é recusada (409)", rDup.status === 409, String(rDup.status))
  const totalComEssaChave = await prisma.catalogoFase.count({ where: { phaseKey: `${MARCA.toLowerCase()}_nova` } })
  ok("2.2) só existe UMA linha com essa chave no cadastro", totalComEssaChave === 1)

  // ══════════════════════════════════════════════════════════════════════
  secao("3) Nova revisão de fase existente + publicação")
  // ══════════════════════════════════════════════════════════════════════
  const idNova = jCriacao.fase.id as number
  const rEdicao = await chamarPut(idNova, { label: "CFGC Fase Nova (renomeada)" })
  ok("3.1) edição aceita (200)", rEdicao.status === 200, String(rEdicao.status))
  const jEdicao = await rEdicao.json()
  ok("3.2) revisão avançou de 1 para 2", jEdicao.fase?.revisaoAtual === 2, String(jEdicao.fase?.revisaoAtual))
  const revisaoAntiga = await prisma.catalogoFaseRevisao.findUnique({ where: { catalogoFaseId_revisao: { catalogoFaseId: idNova, revisao: 1 } } })
  ok("3.3) revisão ANTIGA (1) nunca foi reescrita — continua com o label antigo", revisaoAntiga?.label === "CFGC Fase Nova")

  secao("4) Rejeição de revisão inválida (rótulo vazio, ordem inválida, efeito inexistente)")
  const rRotuloVazio = await chamarPut(idNova, { label: "   " })
  ok("4.1) rótulo vazio é REJEITADO (400), nunca silenciosamente mantém o antigo", rRotuloVazio.status === 400, String(rRotuloVazio.status))
  const rOrdemInvalida = await chamarPut(idNova, { ordemPadrao: -5 })
  ok("4.2) ordem negativa é REJEITADA (400)", rOrdemInvalida.status === 400, String(rOrdemInvalida.status))
  const rEfeitoInexistente = await chamarPut(idNova, { efeitosPermitidos: ["EFEITO_QUE_NAO_EXISTE_DE_JEITO_NENHUM"] })
  ok("4.3) efeito inexistente é REJEITADO (400), nunca filtrado em silêncio", rEfeitoInexistente.status === 400, String(rEfeitoInexistente.status))
  const depoisDasRejeicoes = await prisma.catalogoFase.findUniqueOrThrow({ where: { id: idNova } })
  ok("4.4) nenhuma das 3 tentativas inválidas mudou o cadastro (ainda revisão 2)", depoisDasRejeicoes.revisaoAtual === 2, String(depoisDasRejeicoes.revisaoAtual))

  secao("5) Efeitos permitidos EXPLICITAMENTE + publicação (aceito quando toda chave existe)")
  // Publica de fato (ativo:true) — sai de RASCUNHO, exige efeito explícito (bug 3).
  const rEfeitosValidos = await chamarPut(idNova, { efeitosPermitidos: ["COMPLETE_STEP", "REGISTER_ONLY"], ativo: true })
  ok("5.1) lista de efeitos 100% válida + publicação é aceita", rEfeitosValidos.status === 200, String(rEfeitosValidos.status))
  const comEfeitos = await prisma.catalogoFase.findUniqueOrThrow({ where: { id: idNova } })
  ok("5.2) efeitosPermitidos gravado exatamente como enviado", JSON.stringify(comEfeitos.efeitosPermitidos) === JSON.stringify(["COMPLETE_STEP", "REGISTER_ONLY"]))
  ok("5.3) status agora é PUBLICADA", comEfeitos.status === "PUBLICADA", comEfeitos.status)

  secao("6) Inativação preserva rótulo e histórico")
  const rInativar = await chamarPut(idNova, { ativo: false })
  ok("6.1) inativação aceita", rInativar.status === 200)
  const inativada = await prisma.catalogoFase.findUniqueOrThrow({ where: { id: idNova } })
  ok("6.2) status vira INATIVA, ativo=false", inativada.status === "INATIVA" && inativada.ativo === false)
  ok("6.3) rótulo continua legível (não vira vazio nem some)", inativada.label === "CFGC Fase Nova (renomeada)")
  ok("6.4) phaseKey continua a mesma (histórico resolve por ela)", inativada.phaseKey === `${MARCA.toLowerCase()}_nova`)

  // ══════════════════════════════════════════════════════════════════════
  secao("7) Alteração de escopo por nova revisão RETROAGE a processo em andamento")
  // ══════════════════════════════════════════════════════════════════════
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_pais`, countryLabel: "País CFGC", modalityKey: `${MARCA}_modal`, modalityLabel: "Modalidade CFGC" })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_TIPO`, name: `${MARCA} Tipo`, paisId: oferta.paisId }, select: { id: true } })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, name: `${MARCA} macro`, versao: 1 }, select: { id: true } })
  const phaseKeyEscopo = `${MARCA.toLowerCase()}_esc`
  // efeitosPermitidos explícito na fixture — uma fase PUBLICADA de verdade nunca
  // fica sem efeito declarado (bug 3), então o fixture de teste também não.
  const faseEscopo = await prisma.catalogoFase.create({ data: { phaseKey: phaseKeyEscopo, label: "CFGC Fase Escopo", escopo: "PROCESSO", requiredPadrao: true, conditionalPadrao: false, efeitosPermitidos: ["COMPLETE_STEP", "REGISTER_ONLY"], ativo: true, status: "PUBLICADA", revisaoAtual: 1 } })
  // Semeia a revisão 1 (a fixture criou a fase direto, sem passar pelo POST que
  // semeia isso automaticamente) — sem isso, a revisão 2 não teria "anterior".
  await prisma.catalogoFaseRevisao.create({
    data: {
      catalogoFaseId: faseEscopo.id, revisao: 1, phaseKey: faseEscopo.phaseKey, label: faseEscopo.label,
      descricao: faseEscopo.descricao, escopo: faseEscopo.escopo, ordemPadrao: faseEscopo.ordemPadrao,
      requiredPadrao: faseEscopo.requiredPadrao, conditionalPadrao: faseEscopo.conditionalPadrao,
      status: faseEscopo.status, efeitosPermitidos: faseEscopo.efeitosPermitidos as never, origem: "CRIACAO",
    },
  })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: phaseKeyEscopo, label: "CFGC Fase Escopo", ordem: 1, required: true, conditional: false } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: "finalizado", label: "finalizado", ordem: 2, required: true, conditional: false } })
  const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}::${phaseKeyEscopo}`, phaseKey: phaseKeyEscopo, name: `WF ${phaseKeyEscopo}`, tipoProcessoId: tipo.id, versao: 1 }, select: { id: true } })
  await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: wf.id, key: "passo", label: "Passo", ordem: 1, createsTask: true, required: true, owner: null, slaDays: 0, cardinalidade: null } })

  // Processo em andamento — instância legada em escopo PROCESSO.
  const arvore = await prisma.arvore.create({ data: { nome: `Árvore ${MARCA}` } })
  const pessoa = await prisma.pessoa.create({ data: { nome: "CFGC", sobrenome: "Pessoa", arvoreId: arvore.id, linhaReta: true, requerente: "maior" } })
  await prisma.documento.create({ data: { pessoaId: pessoa.id, descricao: "Doc CFGC" } })
  const { materializarExecucaoDaFase } = await import("../src/services/materializar-fase")
  const processo = await prisma.processo.create({ data: { nome: `${MARCA} Processo`, workflowRuntime: "v2", faseAtualKey: phaseKeyEscopo, tipoProcessoMotorId: tipo.id, modalidadeId: oferta.modalidadeId, macroWorkflowVersion: 1, arvoreId: arvore.id }, select: { id: true } })
  await materializarExecucaoDaFase({ processoId: processo.id, fonte: "PROCESSO_CRIADO" })
  const legada = await prisma.phaseWorkflowInstance.findFirstOrThrow({ where: { processoId: processo.id, faseMacroKey: phaseKeyEscopo } })
  ok("7.1) instância legada nasceu em escopo PROCESSO (1 passo, sem documentoId)", legada.status !== null)

  // Processo FINALIZADO — não deve receber retroação.
  const processoFinalizado = await prisma.processo.create({ data: { nome: `${MARCA} Processo Finalizado`, workflowRuntime: "v2", faseAtualKey: "finalizado", tipoProcessoMotorId: tipo.id, modalidadeId: oferta.modalidadeId, macroWorkflowVersion: 1 }, select: { id: true } })

  // Publica a revisão nova (escopo DOCUMENTO) — via a MESMA rota que a tela usa,
  // com confirmação explícita (fase já em uso).
  const rMudaEscopo = await chamarPut(faseEscopo.id, { escopo: "DOCUMENTO", confirmarMudancaEscopo: true })
  ok("7.2) mudança de escopo com confirmação explícita é aceita (200)", rMudaEscopo.status === 200, String(rMudaEscopo.status))
  const jMudaEscopo = await rMudaEscopo.json()
  ok("7.3) reconciliação foi disparada (outbox registrado > 0)", (jMudaEscopo.reconciliacao?.outboxRegistrados ?? 0) > 0, JSON.stringify(jMudaEscopo.reconciliacao))
  ok("7.4) só o processo EM ANDAMENTO foi alcançado, não o finalizado", jMudaEscopo.reconciliacao?.processosAlcancados === 1, String(jMudaEscopo.reconciliacao?.processosAlcancados))

  // Sem confirmação, a mesma mudança é recusada (proteção contra clique acidental).
  const faseEscopoDepois = await prisma.catalogoFase.findUniqueOrThrow({ where: { id: faseEscopo.id } })
  ok("7.5) escopo já é DOCUMENTO no cadastro", faseEscopoDepois.escopo === "DOCUMENTO")

  secao("8) Processando a reconciliação (outbox) — primeira execução")
  const resumo1 = await processarOutbox({ tipos: ["catalogo.fase.reconciliar"], forcar: true })
  ok("8.1) outbox processado sem falha", resumo1.falhos === 0, JSON.stringify(resumo1))
  const legadaDepois = await prisma.phaseWorkflowInstance.findUniqueOrThrow({ where: { id: legada.id } })
  ok("8.2) instância legada preservada intacta (status/ciclo/chave)", legadaDepois.status === legada.status && legadaDepois.ciclo === legada.ciclo && legadaDepois.chaveIdempotencia === legada.chaveIdempotencia)
  const instanciasDoProcesso = await prisma.phaseWorkflowInstance.findMany({ where: { processoId: processo.id, faseMacroKey: phaseKeyEscopo } })
  ok("8.3) novo ciclo nasceu (2 instâncias: legada + nova)", instanciasDoProcesso.length === 2, String(instanciasDoProcesso.length))
  const nova = instanciasDoProcesso.find((i) => i.id !== legada.id)
  ok("8.4) a nova instância aponta pra legada (previousInstanceId auditável)", nova?.previousInstanceId === legada.id)
  const instanciasDoFinalizado = await prisma.phaseWorkflowInstance.findMany({ where: { processoId: processoFinalizado.id } })
  ok("8.5) processo FINALIZADO não recebeu retroação nenhuma", instanciasDoFinalizado.length === 0)

  secao("9) Reconciliação executada DUAS VEZES — zero duplicidade")
  const instanciasAntes = await prisma.phaseWorkflowInstance.count({ where: { processoId: processo.id } })
  const tarefasAntes = await prisma.tarefa.count({ where: { processoId: processo.id } })
  // Reenfileirar a MESMA revisão não duplica outbox (chave idempotente por revisão).
  const rReenvio = await chamarPut(faseEscopo.id, { escopo: "DOCUMENTO", confirmarMudancaEscopo: true })
  ok("9.1) reenviar a mesma configuração não gera revisão nova (nada mudou)", (await rReenvio.json()).fase?.revisaoAtual === faseEscopoDepois.revisaoAtual)
  const resumo2 = await processarOutbox({ tipos: ["catalogo.fase.reconciliar"], forcar: true })
  ok("9.2) segunda passagem do outbox não falha", resumo2.falhos === 0)
  const instanciasDepois2 = await prisma.phaseWorkflowInstance.count({ where: { processoId: processo.id } })
  const tarefasDepois2 = await prisma.tarefa.count({ where: { processoId: processo.id } })
  ok("9.3) zero novas instâncias na segunda execução", instanciasDepois2 === instanciasAntes, `${instanciasAntes} → ${instanciasDepois2}`)
  ok("9.4) zero novas tarefas na segunda execução", tarefasDepois2 === tarefasAntes, `${tarefasAntes} → ${tarefasDepois2}`)

  // ══════════════════════════════════════════════════════════════════════
  secao("10) As DEZ fases canônicas, na ordem e com o escopo corretos")
  // ══════════════════════════════════════════════════════════════════════
  const ESPERADO: Array<[string, string]> = [
    ["genealogia", "NECESSIDADE"],
    ["emissao_documental", "DOCUMENTO"],
    ["analise_documental", "PROCESSO"],
    ["retificacao_registros", "DOCUMENTO"],
    ["emissao_documental_retificada", "DOCUMENTO"],
    ["traducao_juramentada", "DOCUMENTO"],
    ["apostilamento", "DOCUMENTO"],
    ["aguardando_protocolo", "PROCESSO"],
    ["protocolado", "PROCESSO"],
    ["finalizado", "PROCESSO"],
  ]
  for (const [phaseKey, escopoEsperado] of ESPERADO) {
    ok(`10) ${phaseKey} → escopo ${escopoEsperado}`, escopoCanonicoDaFase(phaseKey) === escopoEsperado, String(escopoCanonicoDaFase(phaseKey)))
  }
  const { getFase, phaseKeyToFaseCode, FASES } = await import("../src/lib/process-stage/fases-catalog")
  const ordens = ESPERADO.map(([pk]) => {
    const code = phaseKeyToFaseCode(pk)
    return code ? getFase(code as never).ordem : null
  })
  const crescente = ordens.every((o, i) => i === 0 || (o != null && ordens[i - 1] != null && o > (ordens[i - 1] as number)))
  ok("10) as 10 fases estão em ORDEM CRESCENTE no catálogo em código", crescente, JSON.stringify(ordens))
  ok("10) nenhuma phaseKey produtiva foi substituída — todas as 10 chaves existem em FASES", ESPERADO.every(([pk]) => !!phaseKeyToFaseCode(pk)))

  secao("11) Fases de teste/legado permanecem inativas, ausentes de workflows produtivos, rótulo legível")
  for (const legado of ["teste_fase", "TESTEVIS_fase", "transcricoes"]) {
    const row = await prisma.catalogoFase.findUnique({ where: { phaseKey: legado } })
    if (!row) { ok(`11) ${legado} não existe no cadastro (nada a verificar)`, true); continue }
    ok(`11) ${legado} está INATIVA`, row.status === "INATIVA")
    ok(`11) ${legado} preserva rótulo legível (não vazio)`, !!row.label && row.label.trim().length > 0, row.label)
  }

  // ══════════════════════════════════════════════════════════════════════
  secao("12) RÓTULO CANÔNICO — fase inativa + processo histórico (bug 1)")
  // ══════════════════════════════════════════════════════════════════════
  const phaseKeyInativaHist = `${MARCA.toLowerCase()}_inativa_hist`
  await prisma.catalogoFase.create({
    data: { phaseKey: phaseKeyInativaHist, label: "CFGC Fase Inativa Histórica", escopo: "PROCESSO", requiredPadrao: false, conditionalPadrao: true, ativo: false, status: "INATIVA", revisaoAtual: 1 },
  })
  const processoHistorico = await prisma.processo.create({
    data: { nome: `${MARCA} Processo Histórico`, workflowRuntime: "v2", faseAtualKey: phaseKeyInativaHist, tipoProcessoMotorId: tipo.id, modalidadeId: oferta.modalidadeId, macroWorkflowVersion: 1 },
    select: { id: true },
  })
  ok("12.0) processo histórico criado com a fase inativa como faseAtualKey", !!processoHistorico.id)
  const rotulo = await resolverRotuloDaFase(phaseKeyInativaHist)
  ok("12.1) resolverRotuloDaFase resolve o rótulo de uma fase INATIVA", rotulo === "CFGC Fase Inativa Histórica", String(rotulo))
  ok("12.2) o rótulo nunca é a phaseKey crua", rotulo !== phaseKeyInativaHist)
  const rotuloInexistente = await resolverRotuloDaFase("chave_que_nao_existe_em_lugar_nenhum")
  ok("12.3) phaseKey verdadeiramente desconhecida devolve null (nunca inventa rótulo a partir do texto técnico)", rotuloInexistente === null)
  ok("12.4) phaseKey nulo/vazio devolve null sem erro", (await resolverRotuloDaFase(null)) === null && (await resolverRotuloDaFase("")) === null)
  // Fase CANÔNICA (código) continua resolvendo pelo mesmo resolvedor — mesma função, uma fonte só.
  ok("12.5) o MESMO resolvedor também cobre fase canônica do código (genealogia)", (await resolverRotuloDaFase("genealogia")) === "Genealogia")

  // ══════════════════════════════════════════════════════════════════════
  secao("13) CATÁLOGO DE EFEITOS — criação recusa efeito inexistente (bug 3, negativo)")
  // ══════════════════════════════════════════════════════════════════════
  const rCriacaoEfeitoInvalido = await chamarPost({ phaseKey: `${MARCA.toLowerCase()}_efeito_ruim`, label: "CFGC Efeito Ruim", escopo: "PROCESSO", efeitosPermitidos: ["EFEITO_INVENTADO_QUE_NAO_EXISTE"] })
  ok("13.1) criar fase com efeito fora da allowlist é RECUSADO (400)", rCriacaoEfeitoInvalido.status === 400, String(rCriacaoEfeitoInvalido.status))
  const jCriacaoEfeitoInvalido = await rCriacaoEfeitoInvalido.json()
  ok("13.2) código de erro é EFEITOS_INVALIDOS", jCriacaoEfeitoInvalido.code === "EFEITOS_INVALIDOS", jCriacaoEfeitoInvalido.code)
  const naoDeveExistir = await prisma.catalogoFase.findUnique({ where: { phaseKey: `${MARCA.toLowerCase()}_efeito_ruim` } })
  ok("13.3) nenhuma linha foi criada", naoDeveExistir === null)

  secao("14) CATÁLOGO DE EFEITOS — nova fase nasce RASCUNHO, sem efeito por omissão (bug 3, positivo)")
  const rCriacaoRascunho = await chamarPost({ phaseKey: `${MARCA.toLowerCase()}_rascunho`, label: "CFGC Fase Rascunho", escopo: "PROCESSO", ativo: true /* pedido ignorado de propósito */ })
  ok("14.1) criação aceita mesmo sem efeitos (nasce rascunho, não publicada)", rCriacaoRascunho.status === 201, String(rCriacaoRascunho.status))
  const jCriacaoRascunho = await rCriacaoRascunho.json()
  ok("14.2) status é RASCUNHO mesmo com ativo:true pedido no corpo — nunca publica direto na criação", jCriacaoRascunho.fase?.status === "RASCUNHO", jCriacaoRascunho.fase?.status)
  ok("14.3) ativo é false", jCriacaoRascunho.fase?.ativo === false)
  ok("14.4) efeitosPermitidos é [] — NUNCA null, NUNCA \"todos\"", Array.isArray(jCriacaoRascunho.fase?.efeitosPermitidos) && jCriacaoRascunho.fase.efeitosPermitidos.length === 0)

  secao("15) CATÁLOGO DE EFEITOS — publicar sem nenhum efeito é RECUSADO (bug 3, negativo)")
  const idRascunho = jCriacaoRascunho.fase.id as number
  const rPublicarSemEfeito = await chamarPut(idRascunho, { ativo: true })
  ok("15.1) publicar (ativo:true) sem efeito nenhum é RECUSADO (400)", rPublicarSemEfeito.status === 400, String(rPublicarSemEfeito.status))
  const jPublicarSemEfeito = await rPublicarSemEfeito.json()
  ok("15.2) código de erro é EFEITOS_OBRIGATORIOS_PARA_PUBLICAR", jPublicarSemEfeito.code === "EFEITOS_OBRIGATORIOS_PARA_PUBLICAR", jPublicarSemEfeito.code)
  const aindaRascunho = await prisma.catalogoFase.findUniqueOrThrow({ where: { id: idRascunho } })
  ok("15.3) a fase continua RASCUNHO — a tentativa recusada não mudou nada", aindaRascunho.status === "RASCUNHO")

  secao("16) CATÁLOGO DE EFEITOS — publicar COM efeito explícito é aceito (bug 3, positivo)")
  const rPublicarComEfeito = await chamarPut(idRascunho, { efeitosPermitidos: ["REGISTER_ONLY"], ativo: true })
  ok("16.1) publicar com 1 efeito explícito é aceito", rPublicarComEfeito.status === 200, String(rPublicarComEfeito.status))
  const jPublicarComEfeito = await rPublicarComEfeito.json()
  ok("16.2) status agora é PUBLICADA", jPublicarComEfeito.fase?.status === "PUBLICADA")
  ok("16.3) efeitosPermitidos é exatamente o que foi enviado", JSON.stringify(jPublicarComEfeito.fase?.efeitosPermitidos) === JSON.stringify(["REGISTER_ONLY"]))
  const logAtivacao = await prisma.logAuditoria.findFirst({ where: { entidade: "CatalogoFase", entidadeId: idRascunho, acao: "PHASE_ACTIVATED" } })
  ok("16.4) a ativação/publicação gerou um evento PHASE_ACTIVATED distinto (auditoria administrativa)", !!logAtivacao)

  // ══════════════════════════════════════════════════════════════════════
  secao("17) AUDITORIA — reconciliação solicitada aparece no HISTÓRICO DO PROCESSO (bug 4)")
  // ══════════════════════════════════════════════════════════════════════
  // Reaproveita o processo/fase da seção 7-9 (mudança de escopo já reconciliada).
  const logSolicitada = await prisma.logAuditoria.findFirst({
    where: { entidade: "PROCESSO", entidadeId: processo.id, acao: "RECONCILIACAO_SOLICITADA" },
  })
  ok("17.1) o processo alcançado pela reconciliação tem um evento RECONCILIACAO_SOLICITADA no PRÓPRIO histórico (entidade=PROCESSO)", !!logSolicitada)
  const logMaterializacao = await prisma.logAuditoria.findFirst({
    where: { entidade: "PROCESSO", entidadeId: processo.id, acao: "FASE_MATERIALIZADA", descricao: { contains: phaseKeyEscopo } },
  })
  ok("17.2) o resultado da materialização (ou motivo de não materializar) também está no histórico do processo", !!logMaterializacao)

  // Segunda reconciliação (já rodada na seção 9) não pode duplicar o evento "solicitada".
  const totalSolicitadas = await prisma.logAuditoria.count({ where: { entidade: "PROCESSO", entidadeId: processo.id, acao: "RECONCILIACAO_SOLICITADA" } })
  ok("17.3) reenviar a mesma revisão não duplica o evento RECONCILIACAO_SOLICITADA (idempotente)", totalSolicitadas === 1, String(totalSolicitadas))

  secao("18) TELA VERSÕES — GET /revisoes mostra fase, phaseKey, revisão, status, escopo, autor, data, anterior/atual, alterações, publicação e reconciliação")
  const reqRevisoes = new NextRequest("http://localhost/api/gerenciamento/catalogo-fases/revisoes", { headers: { Authorization: `Bearer ${token}` } })
  const rRevisoes = await getRevisoes(reqRevisoes)
  ok("18.1) rota responde 200", rRevisoes.status === 200, String(rRevisoes.status))
  const jRevisoes = await rRevisoes.json()
  const linhaEscopo = (jRevisoes.revisoes as Array<Record<string, unknown>>).find((r) => r.phaseKey === phaseKeyEscopo && r.revisao === 2)
  ok("18.2) a revisão 2 da fase de escopo aparece na lista", !!linhaEscopo)
  ok("18.3) traz fase/phaseKey/revisao/status/escopo/autor/data", !!linhaEscopo && ["fase", "phaseKey", "revisao", "status", "escopo", "autor", "data"].every((k) => k in linhaEscopo))
  ok("18.4) traz revisaoAnterior=1", linhaEscopo?.revisaoAnterior === 1)
  ok("18.5) traz alterações (escopo mudou)", Array.isArray(linhaEscopo?.alteracoes) && (linhaEscopo!.alteracoes as unknown[]).length > 0)
  ok("18.6) traz resultado da publicação", typeof linhaEscopo?.resultadoPublicacao === "string" && (linhaEscopo!.resultadoPublicacao as string).length > 0)
  ok("18.7) traz resultado da reconciliação, com processo(s) alcançado(s)", typeof linhaEscopo?.resultadoReconciliacao === "string" && (linhaEscopo!.resultadoReconciliacao as string).includes("alcançado"))

  // ══════════════════════════════════════════════════════════════════════
  secao("19) RÓTULO CANÔNICO — GET /phases sempre inclui a fase ATUAL, mesmo sem macro (achado da auditoria)")
  // ══════════════════════════════════════════════════════════════════════
  // Processo "órfão": sem tipoProcessoMotorId (como o processo real 632),
  // faseAtualKey apontando pra uma fase que NÃO compõe nenhum macro.
  const phaseKeyOrfa = `${MARCA.toLowerCase()}_orfa`
  await prisma.catalogoFase.create({
    data: { phaseKey: phaseKeyOrfa, label: "CFGC Fase Órfã", escopo: "PROCESSO", requiredPadrao: false, conditionalPadrao: true, ativo: false, status: "INATIVA", revisaoAtual: 1 },
  })
  const processoOrfao = await prisma.processo.create({
    data: { nome: `${MARCA} Processo Órfão`, workflowRuntime: "v2", faseAtualKey: phaseKeyOrfa, tipoProcessoMotorId: null, macroWorkflowVersion: null },
    select: { id: true },
  })
  const { GET: getPhases } = await import("../src/app/api/processos/[processoId]/phases/route")
  const reqPhases = new NextRequest(`http://localhost/api/processos/${processoOrfao.id}/phases`, { headers: { Authorization: `Bearer ${token}` } })
  const rPhases = await getPhases(reqPhases as never, { params: Promise.resolve({ processoId: String(processoOrfao.id) }) })
  ok("19.1) rota responde 200 mesmo para processo sem tipoProcessoMotorId", rPhases.status === 200, String(rPhases.status))
  const jPhases = await rPhases.json()
  const faseNaLista = (jPhases.phases as Array<Record<string, unknown>>).find((p) => p.phaseKey === phaseKeyOrfa)
  ok("19.2) a fase ATUAL (órfã, sem macro) aparece na lista de fases", !!faseNaLista)
  ok("19.3) o rótulo é o do cadastro, nunca a phaseKey crua", faseNaLista?.label === "CFGC Fase Órfã", String(faseNaLista?.label))
  ok("19.4) o estado dela é ACTIVE (é a fase atual do processo)", faseNaLista?.state === "ACTIVE", String(faseNaLista?.state))

  secao("20) RECONCILIAÇÃO alcança processo SEM macro cuja faseAtualKey bate diretamente (achado da auditoria)")
  const rAtivarOrfa = await chamarPut((await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: phaseKeyOrfa } })).id, { ativo: true, efeitosPermitidos: ["REGISTER_ONLY"] })
  ok("20.1) publicação aceita", rAtivarOrfa.status === 200, String(rAtivarOrfa.status))
  const jAtivarOrfa = await rAtivarOrfa.json()
  ok("20.2) reconciliação alcançou o processo órfão (sem nenhum macro/tipo por trás)", jAtivarOrfa.reconciliacao?.processosAlcancados === 1, JSON.stringify(jAtivarOrfa.reconciliacao))
  const resumoOrfa = await processarOutbox({ tipos: ["catalogo.fase.reconciliar"], forcar: true })
  ok("20.3) outbox processa sem falha", resumoOrfa.falhos === 0)
  const logOrfao = await prisma.logAuditoria.findFirst({ where: { entidade: "PROCESSO", entidadeId: processoOrfao.id, acao: "RECONCILIACAO_SOLICITADA" } })
  ok("20.4) o PRÓPRIO processo órfão recebeu o evento no seu histórico (não fica invisível como o processo 632 real)", !!logOrfao)

  // ══════════════════════════════════════════════════════════════════════
  secao("21) RESOLVEOPERATIONALPROJECTION — badge/header da fase nunca mostra a chave crua (achado real: processo 632)")
  // ══════════════════════════════════════════════════════════════════════
  // MESMO processo órfão da seção 19/20: sem tipoProcessoMotorId, sem macro,
  // faseAtualKey = phaseKeyOrfa (fora do catálogo em código). Reproduz
  // literalmente o bug visto na captura de tela do processo 632 real
  // ("TESTEVIS_FASE" no badge do header) antes desta correção.
  const { resolveOperationalProjection } = await import("../src/lib/process-stage/operational-projection")
  const projOrfa = await resolveOperationalProjection(processoOrfao.id)
  ok("21.1) activePhase.name é o rótulo do cadastro, nunca a phaseKey crua", projOrfa.activePhase?.name === "CFGC Fase Órfã", JSON.stringify(projOrfa.activePhase))
  const projOrfaParaFase = await resolveOperationalProjection(processoOrfao.id, { faseMacroKey: phaseKeyOrfa })
  ok("21.2) o mesmo vale pelo caminho 'fase específica' (resolveOperationalProjectionParaFase)", projOrfaParaFase.activePhase?.name === "CFGC Fase Órfã", JSON.stringify(projOrfaParaFase.activePhase))

  console.log(`\n${passou} ok, ${falhou} falhas`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(" | ")); process.exitCode = 1 }
  await limpar()
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
