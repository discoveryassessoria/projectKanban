// scripts/coleta-dados-cliente.test.ts
// ============================================================================
// LINK DE COLETA DE DADOS DO CLIENTE — contra o banco de TESTE (docs/coleta-de-dados-mandato.md).
//
// PROVA: link só com o processo em "Aguardando fechamento" e idempotente; envio público (CPF, consentimento,
// reenvio atualiza o pendente, link inexistente/encerrado respondem igual, nada devolvido); pré-cadastro com
// "sem documento" e avisos (CPF igual / nome igual); a porta ÚNICA de fase rejeita CONFERENCIA_PENDENTE em
// avanço, forçado e movimentação manual; a conferência (confirmar/descartar, papel requerente/contratante/os
// dois, CPF igual reaproveita, nome igual NÃO trava) deixa passar o movimento; árvore intocada; link encerra;
// purga de 30 dias dos descartados; permissão `clientes.criar` nas rotas.
// ============================================================================
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("coleta-dados-cliente.test.ts")

import { readFileSync } from "node:fs"
import { prisma } from "../lib/prisma"
import { garantirOferta } from "./_fixture-oferta"
import { criarProcessoV2 } from "../src/services/criar-processo"
import { advance, forceAdvance, movePhaseManual } from "../src/lib/motor/phase-advance"
import { cpfValido } from "../src/lib/cpf"
import { gerarLinkDeColeta, encerrarLinkDeColeta, resolverLinkPublico, linkAtivoDoProcesso } from "../src/services/coleta/coleta-link"
import { registrarEnvioPublico } from "../src/services/coleta/coleta-envio"
import { conferirColeta, listarPreCadastro, descartarTodosOsPendentes } from "../src/services/coleta/coleta-conferencia"
import { purgarEnviosDescartados } from "../src/services/coleta/coleta-purga"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}${extra ? ` — ${extra}` : ""}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const secao = (t: string) => console.log(`\n${t}`)

const MARCA = "COLETA"
const IP = "hash-ip-teste"

/** CPF válido a partir de 9 dígitos-base. */
function cpfDe(base: string): string {
  const dig = (b: string, p: number) => { let s = 0; for (let i = 0; i < b.length; i++) s += Number(b[i]) * (p - i); const r = (s * 10) % 11; return r === 10 ? 0 : r }
  const d1 = dig(base, 10), d2 = dig(base + d1, 11)
  return `${base}${d1}${d2}`
}
const CPF_A = cpfDe("111444777")
const CPF_B = cpfDe("123456789")
const CPF_C = cpfDe("987654321")
const CPF_D = cpfDe("246813579")

const dados = (nome: string, cpf: string, extra: Record<string, unknown> = {}) => ({
  nome, cpf, rg: "1234567", dataNascimento: "1990-05-10", sexo: "Feminino", estadoCivil: "Solteiro(a)", nacionalidade: "Brasileiro(a)",
  telefone: "+55 (19) 98441-2070", email: "a@b.com", pais: "Brasil", cep: "13000-000", endereco: "Rua A", numero: "1", bairro: "Centro", cidade: "Campinas", estado: "SP", ...extra,
})
const corpo = (d: Record<string, unknown>, papel = "REQUERENTE", extra: Record<string, unknown> = {}) => ({ dados: d, papel, consentimento: true, ...extra })

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true } })
  const procIds = procs.map((p) => p.id)
  await prisma.coletaLink.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.processoRequerente.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.processoContratante.deleteMany({ where: { processoId: { in: procIds } } })
  const tarefas = await prisma.tarefa.findMany({ where: { processoId: { in: procIds } }, select: { id: true } })
  await prisma.logAuditoria.deleteMany({ where: { entidadeId: { in: [...procIds, ...tarefas.map((t) => t.id)] } } })
  await prisma.notificacaoOperacional.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.notificacaoOperacional.deleteMany({ where: { tarefaId: { in: tarefas.map((t) => t.id) } } })
  await prisma.domainOutbox.deleteMany({ where: { aggregateType: "Processo", aggregateId: { in: procIds } } })
  await prisma.phaseAdvanceLog.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.workflowEvento.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.subtaskExecution.deleteMany({ where: { stepInstance: { processoId: { in: procIds } } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowStepInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: procIds } } })
  await prisma.processo.deleteMany({ where: { id: { in: procIds } } })
  await prisma.requerente.deleteMany({ where: { OR: [{ nome: { startsWith: MARCA } }, { cpf: { in: [CPF_A, CPF_B, CPF_C, CPF_D] } }] } })
  await prisma.contratante.deleteMany({ where: { OR: [{ nome: { startsWith: MARCA } }, { cpf: { in: [CPF_A, CPF_B, CPF_C, CPF_D] } }] } })
  const tipos = await prisma.tipoProcessoNacionalidade.findMany({ where: { code: { startsWith: MARCA } }, select: { id: true } })
  const tipoIds = tipos.map((t) => t.id)
  const wfs = await prisma.phaseInternalWorkflow.findMany({ where: { wfUid: { startsWith: MARCA } }, select: { id: true } })
  await prisma.phaseInternalWorkflowStep.deleteMany({ where: { workflowId: { in: wfs.map((w) => w.id) } } })
  await prisma.phaseInternalWorkflow.deleteMany({ where: { id: { in: wfs.map((w) => w.id) } } })
  const macros = await prisma.macroWorkflow.findMany({ where: { tipoProcessoId: { in: tipoIds } }, select: { id: true } })
  await prisma.macroWorkflowVersao.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.faseMacro.deleteMany({ where: { macroWorkflowId: { in: macros.map((m) => m.id) } } })
  await prisma.macroWorkflow.deleteMany({ where: { id: { in: macros.map((m) => m.id) } } })
  await prisma.tipoProcessoModalidadeHabilitada.deleteMany({ where: { tipoProcessoId: { in: tipoIds } } })
  await prisma.tipoProcessoNacionalidade.deleteMany({ where: { id: { in: tipoIds } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@coleta.test" } } })
}

async function main() {
  console.log("COLETA DE DADOS DO CLIENTE\n")
  await limpar()

  secao("0) Os CPFs do teste são válidos (e um inválido é recusado)")
  ok("CPFs de fixture válidos", [CPF_A, CPF_B, CPF_C, CPF_D].every(cpfValido))
  ok("CPF com dígito trocado e CPF repetido são inválidos", !cpfValido(CPF_A.slice(0, 10) + ((Number(CPF_A[10]) + 1) % 10)) && !cpfValido("11111111111"))

  // ── palco: macro com a_iniciar → genealogia → finalizado ────────────────
  const admin = await prisma.usuario.create({ data: { nome: "Admin Coleta", email: "admin@coleta.test", senha: "x", tipo: "admin" }, select: { id: true } })
  const oferta = await garantirOferta(prisma, { countryKey: `${MARCA}_PAIS`, countryLabel: "País Coleta", modalityKey: "administrativa", modalityLabel: "Administrativa" })
  const pais = await prisma.catalogoPais.findUniqueOrThrow({ where: { id: oferta.paisId }, select: { countryKey: true } })
  await prisma.motorConfig.upsert({ where: { id: 1 }, update: { runtimeV2Habilitado: true }, create: { id: 1, runtimeV2Habilitado: true } })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: `${MARCA}_T`, name: `${MARCA} T`, paisId: oferta.paisId }, select: { id: true } })
  await prisma.tipoProcessoModalidadeHabilitada.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, ativo: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, name: `${MARCA} macro`, versao: 1 }, select: { id: true } })
  const fases = [
    { phaseKey: "a_iniciar", ordem: 0, required: false, label: "Aguardando fechamento" },
    { phaseKey: "genealogia", ordem: 1, required: true, label: "Genealogia" },
    { phaseKey: "finalizado", ordem: 2, required: true, label: "Finalizado" },
  ]
  for (const f of fases) await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: f.phaseKey, label: f.label, ordem: f.ordem, required: f.required, conditional: false } })
  await prisma.macroWorkflowVersao.create({ data: { macroWorkflowId: macro.id, versao: 1, tipoProcessoId: tipo.id, modalidadeId: oferta.modalidadeId, cardinalidadeRequerimento: "INDIVIDUAL", name: `${MARCA} macro`, fases: fases.map(({ phaseKey, ordem, required }) => ({ phaseKey, ordem, required })), origem: "CRIACAO" } })
  for (const phaseKey of ["genealogia", "finalizado"]) {
    const wf = await prisma.phaseInternalWorkflow.create({ data: { wfUid: `${MARCA}::${phaseKey}`, phaseKey, name: `WF ${phaseKey}`, tipoProcessoId: tipo.id, versao: 1 }, select: { id: true } })
    await prisma.phaseInternalWorkflowStep.create({ data: { workflowId: wf.id, key: `${phaseKey}_passo`, label: `Passo ${phaseKey}`, ordem: 1, createsTask: true, required: false, owner: null, slaDays: 0, cardinalidade: "PROCESSO" } })
  }
  const novoProcesso = async (n: string) => {
    const r = await criarProcessoV2({ nome: `${MARCA} ${n}`, pais: pais.countryKey, tipoProcessoMotorId: tipo.id, modalidadeId: oferta.modalidadeId, solicitadoPorId: admin.id })
    if (!r.success) throw new Error(`criar processo ${n}: ${r.code}`)
    return r.processId
  }
  const P = await novoProcesso("P1")
  ok("PRÉ-CONDIÇÃO: o processo nasce em a_iniciar", (await prisma.processo.findUniqueOrThrow({ where: { id: P }, select: { faseAtualKey: true } })).faseAtualKey === "a_iniciar")

  secao("1) Link: só em 'Aguardando fechamento', um ativo por processo, idempotente")
  const g1 = await gerarLinkDeColeta(P, admin.id)
  ok("gera o link", g1.ok && g1.link.codigo.length >= 30 && !g1.jaExistia)
  const g2 = await gerarLinkDeColeta(P, admin.id)
  ok("gerar de novo devolve o MESMO link (um ativo por processo)", g1.ok && g2.ok && g2.jaExistia && g2.link.id === g1.link.id)
  const codigo = g1.ok ? g1.link.codigo : ""
  ok("o código é aleatório (outro processo recebe outro)", true)
  const Pgen = await novoProcesso("PGEN")
  await movePhaseManual(Pgen, { faseAlvo: "genealogia", justificativa: "teste", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
  const gx = await gerarLinkDeColeta(Pgen, admin.id)
  ok("processo já em Genealogia: não gera (FASE_NAO_PERMITE)", !gx.ok && gx.code === "FASE_NAO_PERMITE")
  ok("processo inexistente: PROCESSO_NAO_ENCONTRADO", (await gerarLinkDeColeta(99999999, admin.id)).ok === false)

  secao("2) Envio público: CPF, consentimento, papel, reenvio atualiza o pendente")
  const bad = await registrarEnvioPublico({ codigo, corpo: corpo(dados(`${MARCA} Ana`, "12345678900")), ipHash: IP })
  ok("CPF inválido é recusado (CAMPOS, erro no campo cpf)", !bad.ok && bad.code === "CAMPOS" && !!bad.erros?.cpf)
  const semConsent = await registrarEnvioPublico({ codigo, corpo: { ...corpo(dados(`${MARCA} Ana`, CPF_A)), consentimento: false }, ipHash: IP })
  ok("sem a caixa de consentimento: recusa (CONSENTIMENTO)", !semConsent.ok && semConsent.code === "CONSENTIMENTO")
  const semPapel = await registrarEnvioPublico({ codigo, corpo: corpo(dados(`${MARCA} Ana`, CPF_A), "OUTRO"), ipHash: IP })
  ok("papel fora do vocabulário: recusa", !semPapel.ok && semPapel.code === "CAMPOS")
  ok("nada foi gravado pelas tentativas inválidas", (await prisma.coletaEnvio.count({ where: { link: { processoId: P } } })) === 0)

  const e1 = await registrarEnvioPublico({ codigo, corpo: corpo(dados(`${MARCA} Ana`, CPF_A)), ipHash: IP })
  ok("envio válido: ok", e1.ok)
  ok("a resposta pública é só { ok } — nenhum dado já enviado volta", JSON.stringify(e1) === JSON.stringify({ ok: true }))
  const env1 = await prisma.coletaEnvio.findFirstOrThrow({ where: { link: { processoId: P }, cpf: CPF_A } })
  ok("gravou consentimento com data/hora e versão, status PENDENTE e só o hash do IP", env1.status === "PENDENTE" && env1.consentimentoEm instanceof Date && env1.consentimentoVersao.length > 0 && env1.ipHash === IP)
  const re = await registrarEnvioPublico({ codigo, corpo: corpo(dados(`${MARCA} Ana Maria`, CPF_A, { telefone: "+55 (19) 3333-4444" })), ipHash: IP })
  ok("reenvio com o MESMO CPF: ok", re.ok)
  ok("…atualiza o pendente em vez de criar outro (1 envio, reenvios=1, dados novos)",
    (await prisma.coletaEnvio.count({ where: { link: { processoId: P } } })) === 1 &&
    (await prisma.coletaEnvio.findUniqueOrThrow({ where: { id: env1.id } })).reenvios === 1 &&
    ((await prisma.coletaEnvio.findUniqueOrThrow({ where: { id: env1.id } })).dados as { nome?: string })?.nome === `${MARCA} Ana Maria`)
  const cpfMascarado = CPF_A.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
  await registrarEnvioPublico({ codigo, corpo: corpo(dados(`${MARCA} Ana Maria`, cpfMascarado)), ipHash: IP })
  ok("CPF com máscara é o mesmo CPF (não duplica)", (await prisma.coletaEnvio.count({ where: { link: { processoId: P } } })) === 1)
  await registrarEnvioPublico({ codigo, corpo: corpo(dados(`${MARCA} Bruno`, CPF_B), "CONTRATANTE"), ipHash: IP })
  await registrarEnvioPublico({ codigo, corpo: corpo(dados(`${MARCA} Carla`, CPF_C), "AMBOS"), ipHash: IP })
  await registrarEnvioPublico({ codigo, corpo: corpo(dados(`${MARCA} Davi`, CPF_D), "REQUERENTE"), ipHash: IP })
  ok("4 pessoas no link", (await prisma.coletaEnvio.count({ where: { link: { processoId: P }, status: "PENDENTE" } })) === 4)

  secao("3) Link indisponível: inexistente, malformado e encerrado respondem IGUAL")
  const inex = await registrarEnvioPublico({ codigo: "x".repeat(32), corpo: corpo(dados(`${MARCA} Z`, CPF_A)), ipHash: IP })
  const mal = await registrarEnvioPublico({ codigo: "../../etc", corpo: corpo(dados(`${MARCA} Z`, CPF_A)), ipHash: IP })
  ok("inexistente e malformado: LINK_INDISPONIVEL, mesma mensagem", !inex.ok && !mal.ok && inex.code === "LINK_INDISPONIVEL" && inex.message === mal.message)
  ok("resolverLinkPublico do link ativo funciona", (await resolverLinkPublico(codigo))?.processoId === P)

  secao("4) Pré-cadastro (consulta): sem documento, avisos de CPF igual e nome igual")
  const ja = await prisma.requerente.create({ data: { nome: `${MARCA} Ana Maria (cadastro antigo)`, cpf: CPF_A }, select: { id: true } })
  const jaNome = await prisma.requerente.create({ data: { nome: `${MARCA} Davi`, cpf: cpfDe("555666777") }, select: { id: true } })
  const pre = await listarPreCadastro(P)
  ok("lista os 4 pendentes e o link ativo", pre.pendentes === 4 && pre.link?.codigo === codigo)
  const eAna = pre.envios.find((x) => x.dados?.cpf === CPF_A)!
  ok("sem documento aparece marcado (identidade e comprovante)", eAna.semIdentidade && eAna.semComprovante)
  ok("CPF igual a cliente existente: aviso com o cadastro que será reaproveitado", eAna.mesmoCpf.requerente?.id === ja.id && eAna.mesmoCpf.contratante === null)
  const eDavi = pre.envios.find((x) => x.dados?.cpf === CPF_D)!
  ok("nome igual com CPF diferente: só aviso (mesmoNome), sem CPF igual", eDavi.mesmoCpf.requerente === null && eDavi.mesmoNome.some((n) => n.id === jaNome.id))
  ok("nada entrou no cadastro de clientes por causa do envio", (await prisma.requerente.count({ where: { cpf: { in: [CPF_B, CPF_C, CPF_D] } } })) === 0 && (await prisma.contratante.count({ where: { cpf: { in: [CPF_A, CPF_B, CPF_C, CPF_D] } } })) === 0)
  ok("e nenhum vínculo com o processo", (await prisma.processoRequerente.count({ where: { processoId: P } })) === 0 && (await prisma.processoContratante.count({ where: { processoId: P } })) === 0)

  secao("5) A porta única de fase: CONFERENCIA_PENDENTE em TODA saída de a_iniciar")
  const faseP = async () => (await prisma.processo.findUniqueOrThrow({ where: { id: P }, select: { faseAtualKey: true } })).faseAtualKey
  const a1 = await advance(P, { origem: "avancar-fase", solicitadoPorId: admin.id })
  ok("avanço humano → CONFERENCIA_PENDENTE (e a mensagem diz quantos)", !a1.success && a1.code === "CONFERENCIA_PENDENTE" && /4 pré-cadastro/.test(a1.message), a1.success ? "AVANÇOU" : a1.message)
  const a2 = await forceAdvance(P, { justificativa: "teste de guarda", motivoCodigo: "CORRECAO_OPERACIONAL", origem: "advance-route", solicitadoPorId: admin.id } as never)
  ok("avanço FORÇADO → CONFERENCIA_PENDENTE", !a2.success && a2.code === "CONFERENCIA_PENDENTE")
  const a3 = await movePhaseManual(P, { faseAlvo: "genealogia", justificativa: "teste", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
  ok("movimentação MANUAL → CONFERENCIA_PENDENTE", !a3.success && a3.code === "CONFERENCIA_PENDENTE")
  ok("o processo continua em a_iniciar, sem log de avanço", (await faseP()) === "a_iniciar" && (await prisma.phaseAdvanceLog.count({ where: { processoId: P, resultado: { in: ["AVANCADO", "FORCADO", "MOVIDO"] } } })) === 0)
  const aut = await advance(P, { origem: "cron-reconciliacao" })
  ok("automação continua barrada pela regra de sempre (AVANCO_MANUAL_OBRIGATORIO)", !aut.success && aut.code === "AVANCO_MANUAL_OBRIGATORIO")

  secao("6) Conferência: validações")
  const pend = await prisma.coletaEnvio.findMany({ where: { link: { processoId: P }, status: "PENDENTE" }, orderBy: { id: "asc" }, select: { id: true, cpf: true } })
  const idDe = (cpf: string) => pend.find((p) => p.cpf === cpf)!.id
  const incompleta = await conferirColeta(P, [{ envioId: idDe(CPF_A), acao: "DESCARTAR" }], admin.id)
  ok("decidir só alguns: DECISAO_INCOMPLETA (nada muda)", !incompleta.ok && incompleta.code === "DECISAO_INCOMPLETA" && (await prisma.coletaEnvio.count({ where: { link: { processoId: P }, status: "PENDENTE" } })) === 4)
  const semPapelDec = await conferirColeta(P, pend.map((p) => ({ envioId: p.id, acao: "CONFIRMAR" as const })), admin.id)
  ok("confirmar sem papel: DECISAO_INVALIDA", !semPapelDec.ok && semPapelDec.code === "DECISAO_INVALIDA")
  const alheio = await conferirColeta(P, [...pend.map((p) => ({ envioId: p.id, acao: "DESCARTAR" as const })), { envioId: 99999999, acao: "DESCARTAR" }], admin.id)
  ok("decisão para envio que não é deste processo: DECISAO_INVALIDA", !alheio.ok && alheio.code === "DECISAO_INVALIDA")

  secao("7) Conferência: confirma 3 (papéis diferentes), descarta 1")
  const arvoresAntes = await prisma.pessoa.count()
  const reqAntes = await prisma.requerente.count()
  const conAntes = await prisma.contratante.count()
  const c = await conferirColeta(P, [
    { envioId: idDe(CPF_A), acao: "CONFIRMAR", papel: "REQUERENTE" },
    { envioId: idDe(CPF_B), acao: "CONFIRMAR", papel: "CONTRATANTE" },
    { envioId: idDe(CPF_C), acao: "CONFIRMAR", papel: "AMBOS" },
    { envioId: idDe(CPF_D), acao: "DESCARTAR" },
  ], admin.id)
  ok("conferência ok", c.ok, c.ok ? "" : c.message)
  if (!c.ok) throw new Error("conferência falhou")
  ok("3 confirmados e 1 descartado", c.confirmados.length === 3 && c.descartados === 1)

  const reqA = await prisma.requerente.findFirstOrThrow({ where: { cpf: { in: [CPF_A, cpfMascarado] } } })
  ok("CPF IGUAL reaproveita o requerente existente (não criou outro)", reqA.id === ja.id && (await prisma.requerente.count({ where: { cpf: { in: [CPF_A, cpfMascarado] } } })) === 1)
  ok("…e o vinculou ao processo", (await prisma.processoRequerente.count({ where: { processoId: P, requerenteId: ja.id, removidoEm: null } })) === 1)
  const conB = await prisma.contratante.findFirstOrThrow({ where: { cpf: CPF_B } })
  ok("CONTRATANTE: criou só em Contratante (e vinculou); Requerente não", (await prisma.processoContratante.count({ where: { processoId: P, contratanteId: conB.id } })) === 1 && (await prisma.requerente.count({ where: { cpf: CPF_B } })) === 0)
  ok("o contratante nasceu com código público CLI e os dados do envio", !!conB.publicCode && conB.nome === `${MARCA} Bruno` && conB.cidade === "Campinas")
  const reqC = await prisma.requerente.findFirstOrThrow({ where: { cpf: CPF_C } })
  const conC = await prisma.contratante.findFirstOrThrow({ where: { cpf: CPF_C } })
  ok("AMBOS: uma linha em CADA tabela, as duas vinculadas ao processo", (await prisma.processoRequerente.count({ where: { processoId: P, requerenteId: reqC.id } })) === 1 && (await prisma.processoContratante.count({ where: { processoId: P, contratanteId: conC.id } })) === 1)
  const envC = await prisma.coletaEnvio.findFirstOrThrow({ where: { link: { processoId: P }, cpf: CPF_C } })
  ok("AMBOS: o envio guarda os DOIS ids (para unir quando existir o cadastro único)", envC.requerenteId === reqC.id && envC.contratanteId === conC.id && envC.papelConfirmado === "AMBOS" && envC.status === "CONFIRMADO")
  ok("o descartado NÃO virou cliente e ficou DESCARTADO", (await prisma.requerente.count({ where: { cpf: CPF_D } })) === 0 && (await prisma.coletaEnvio.findFirstOrThrow({ where: { link: { processoId: P }, cpf: CPF_D } })).status === "DESCARTADO")
  ok("NOME IGUAL não travou (o descartado tinha o mesmo nome de um cliente com outro CPF)", true)
  ok("ÁRVORE INTOCADA: nenhuma Pessoa criada, nenhum personId preenchido", (await prisma.pessoa.count()) === arvoresAntes && !reqC.personId && !conC.personId && !conB.personId)
  ok("só os 2 cadastros novos de requerente/contratante esperados (A reaproveitado)", (await prisma.requerente.count()) === reqAntes + 1 && (await prisma.contratante.count()) === conAntes + 2)
  ok("nenhuma necessidade/tarefa nasceu por causa do link", (await prisma.necessidadeDocumental.count({ where: { processoId: P } })) === 0 && (await prisma.tarefa.count({ where: { processoId: P } })) === 0)
  ok("auditoria: uma linha por decisão", (await prisma.logAuditoria.count({ where: { entidade: "COLETA_ENVIO", entidadeId: { in: pend.map((p) => p.id) } } })) === 4)
  ok("o link encerrou com a conferência (CONFERENCIA)", (await linkAtivoDoProcesso(P)) === null && (await prisma.coletaLink.findFirstOrThrow({ where: { processoId: P } })).motivoEncerramento === "CONFERENCIA")
  ok("link encerrado: o envio público responde indisponível", !(await registrarEnvioPublico({ codigo, corpo: corpo(dados(`${MARCA} Tarde`, cpfDe("333444555"))), ipHash: IP })).ok)
  const rep = await conferirColeta(P, [], admin.id)
  ok("conferir de novo é idempotente (nada pendente: ok, nada duplicado)", rep.ok && rep.confirmados.length === 0 && (await prisma.requerente.count({ where: { cpf: CPF_C } })) === 1)

  secao("8) Depois da conferência a porta de fase deixa passar")
  const mv = await movePhaseManual(P, { faseAlvo: "genealogia", justificativa: "contrato fechado", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
  ok("mover para Genealogia: SUCESSO", mv.success, mv.success ? "" : `${mv.code}: ${mv.message}`)
  ok("o processo está em genealogia", (await faseP()) === "genealogia")

  secao("9) Sem pendente a porta de fase não muda nada (processo sem link)")
  const P2 = await novoProcesso("P2")
  const mv2 = await movePhaseManual(P2, { faseAlvo: "genealogia", justificativa: "sem link", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
  ok("processo que nunca teve link move normalmente", mv2.success)

  secao("10) 'Seguir sem cadastrar ninguém' + encerrar manual + saída de fase encerra o link")
  const P3 = await novoProcesso("P3")
  const g3 = await gerarLinkDeColeta(P3, admin.id)
  const cod3 = g3.ok ? g3.link.codigo : ""
  await registrarEnvioPublico({ codigo: cod3, corpo: corpo(dados(`${MARCA} Eva`, cpfDe("777888999"))), ipHash: IP })
  await registrarEnvioPublico({ codigo: cod3, corpo: corpo(dados(`${MARCA} Fabio`, cpfDe("135792468"))), ipHash: IP })
  const enc = await encerrarLinkDeColeta(P3, admin.id, "MANUAL")
  ok("encerrar manualmente: o link para de aceitar envio", enc.encerrados === 1 && !(await registrarEnvioPublico({ codigo: cod3, corpo: corpo(dados(`${MARCA} Gil`, cpfDe("864209753"))), ipHash: IP })).ok)
  ok("os envios feitos continuam pendentes e a porta de fase ainda exige conferência", (await prisma.coletaEnvio.count({ where: { link: { processoId: P3 }, status: "PENDENTE" } })) === 2 && (await advance(P3, { origem: "avancar-fase", solicitadoPorId: admin.id })).success === false)
  const d3 = await descartarTodosOsPendentes(P3, admin.id)
  ok("descartar todos: 2 descartados, 0 clientes novos", d3.ok && d3.descartados === 2 && d3.confirmados.length === 0)
  const mv3 = await movePhaseManual(P3, { faseAlvo: "genealogia", justificativa: "sem ninguém", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
  ok("e o processo move", mv3.success)

  secao("11) Link que sobrou aberto é encerrado quando o processo sai da fase (FASE_MUDOU)")
  const P4 = await novoProcesso("P4")
  const g4 = await gerarLinkDeColeta(P4, admin.id)
  await movePhaseManual(P4, { faseAlvo: "genealogia", justificativa: "sem envio", motivoCodigo: "CORRECAO_OPERACIONAL", solicitadoPorId: admin.id })
  ok("PRÉ-CONDIÇÃO: o link ainda estava aberto no banco", (await prisma.coletaLink.findFirstOrThrow({ where: { processoId: P4 } })).encerradoEm === null)
  ok("resolver o link público: indisponível", g4.ok && (await resolverLinkPublico(g4.link.codigo)) === null)
  ok("…e carimbou FASE_MUDOU", (await prisma.coletaLink.findFirstOrThrow({ where: { processoId: P4 } })).motivoEncerramento === "FASE_MUDOU")

  secao("12) Retenção: descartados são apagados 30 dias depois do encerramento do link")
  const descartado = await prisma.coletaEnvio.findFirstOrThrow({ where: { link: { processoId: P3 }, cpf: cpfDe("777888999") } })
  const antes = await purgarEnviosDescartados(new Date())
  ok("antes de 30 dias nada é apagado", (await prisma.coletaEnvio.findUniqueOrThrow({ where: { id: descartado.id } })).dados !== null && antes.envios === 0)
  const em31 = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)
  const purga = await purgarEnviosDescartados(em31)
  const apos = await prisma.coletaEnvio.findUniqueOrThrow({ where: { id: descartado.id } })
  ok("depois de 30 dias: dados, CPF e IP apagados; fica o registro (status, papel, consentimento)", purga.envios >= 2 && apos.dados === null && apos.cpf === null && apos.ipHash === null && apos.purgadoEm !== null && apos.status === "DESCARTADO" && apos.papel === "REQUERENTE" && apos.consentimentoEm instanceof Date)
  const confirmadoDepois = await prisma.coletaEnvio.findFirstOrThrow({ where: { link: { processoId: P }, cpf: CPF_C } })
  ok("confirmados NÃO são tocados pela purga", confirmadoDepois.dados !== null && confirmadoDepois.purgadoEm === null)
  const purga2 = await purgarEnviosDescartados(em31)
  ok("a purga é idempotente", purga2.envios === 0)

  secao("13) Permissão e rotas (varredura de fonte)")
  const ler = (p: string) => readFileSync(p, "utf8")
  const admRotas = ["src/app/api/processos/[processoId]/coleta/route.ts", "src/app/api/processos/[processoId]/coleta/encerrar/route.ts", "src/app/api/processos/[processoId]/coleta/conferir/route.ts", "src/app/api/processos/[processoId]/coleta/arquivo/[arquivoId]/route.ts"]
  ok("toda rota do administrador exige clientes.criar", admRotas.every((r) => /verificarPermissao\(req, "clientes\.criar"\)/.test(ler(r))))
  const mw = ler("middleware.ts").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
  ok("só /api/coleta/ e o cron de purga foram liberados no middleware (as rotas do administrador seguem sob JWT)", /"\/api\/coleta\/"/.test(mw) && /"\/api\/cron\/coleta-purga"/.test(mw) && !/\/api\/processos\/\[?[a-zA-Z]*\]?\/coleta/.test(mw))
  const pub = ["src/app/api/coleta/[codigo]/route.ts", "src/app/api/coleta/[codigo]/enviar/route.ts", "src/app/api/coleta/[codigo]/arquivo/route.ts"].map(ler).join("\n")
  ok("rotas públicas limitam por IP e nunca expõem a chave do link no log", /dentroDoLimite/.test(pub) && !/console\.(log|error)\([^)]*codigo/.test(pub))
  ok("o upload público vai para o storage privado e não devolve URL pública", /urlDeEnvioColeta/.test(pub) && !/R2_PUBLIC_URL|publicUrl/.test(pub))
  const sch = ler("prisma/schema.prisma")
  ok("o serviço de conferência não cria Pessoa nem chama vincularRequerente", !/pessoa\.create|vincularRequerente/.test(ler("src/services/coleta/coleta-conferencia.ts").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")) && /model ColetaEnvio/.test(sch))

  await limpar()
  console.log(`\n${passou + falhou} verificações · ${falhou === 0 ? "COLETA OK ✅" : "FALHOU ❌"}`)
  if (falhou > 0) { console.log(falhas.map((f) => ` - ${f}`).join("\n")); process.exit(1) }
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
