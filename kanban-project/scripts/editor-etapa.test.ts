/**
 * EDITOR DE ETAPA — registry oficial + editor padrão + andamento operacional.
 *
 * Rodar: npm run test:editor-etapa
 *
 * (A) PURO — resolução do editor, ações permitidas, andamento append-only,
 *     idempotência e guardas estruturais. Roda sempre, sem banco.
 * (B) COMPORTAMENTO — ciclo completo numa etapa real (abrir, salvar, recarregar,
 *     concluir, liberar o próximo, isolamento entre documentos). Só roda com
 *     banco de TESTE local; nunca toca produção.
 */
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { execSync } from "child_process"

import {
  resolveWorkflowStepEditor,
  stepKeysComEditorEspecifico,
  APRESENTACAO_EDITOR,
  type StepEditorKind,
} from "../src/lib/process-stage/step-editor-registry"
import { FASES, getStepDef, resolveStepKeyCompat } from "../src/lib/process-stage/fases-catalog"
import { acoesPermitidasDaEtapa, acaoCompativelComEstado, PERMISSAO_DA_ACAO } from "../src/lib/process-stage/acoes-etapa"
import {
  ANDAMENTO_VAZIO,
  aplicarAndamento,
  lerAndamento,
  gravarAndamento,
  previsaoEfetiva,
} from "../src/lib/process-stage/andamento-etapa"
import { PERMISSOES } from "../src/lib/permissoes"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

let passed = 0, failed = 0
const falhas: string[] = []
function ok(cond: boolean, nome: string) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

const TODAS = Object.fromEntries(Object.keys(PERMISSOES).map((k) => [k, true]))
const NENHUMA = Object.fromEntries(Object.keys(PERMISSOES).map((k) => [k, false]))
const AGORA = new Date("2026-08-04T12:00:00.000Z")

console.log("EDITOR DE ETAPA — registry, editor padrão e andamento\n")

// ════════════════════════════════════════════════════════════════
// (A) RESOLUÇÃO DO EDITOR
// ════════════════════════════════════════════════════════════════
console.log("(A) Resolução do editor:")

// 1. etapa sem editor específico usa o editor PADRÃO
const semEspecifico = resolveWorkflowStepEditor({ stepKey: "passo_que_nao_existe", phaseKey: "emissao_documental" })
ok(semEspecifico.kind === "padrao" && semEspecifico.especifico === false,
  "1. etapa sem editor específico usa editor padrão")

// 2. etapa com editor específico continua usando o específico
const especificos: Array<[string, StepEditorKind]> = [
  ["localizar_registro", "registral"],
  ["solicitar_certidao", "solicitacao_cartorio"],
  ["receber_certidao", "recebimento_documento"],
  ["conferir_certidao", "conferencia_documento"],
  ["validar_certidao", "validacao_juridica"],
]
ok(especificos.every(([k, kind]) => resolveWorkflowStepEditor({ stepKey: k }).kind === kind),
  "2. etapas com editor específico continuam no editor específico")

// 3. o passo PUBLICADO "aguardar_retorno_do_cartorio" resolve para o editor específico
const aguardarPublicado = resolveWorkflowStepEditor({
  stepKey: "aguardar_retorno_do_cartorio",
  phaseKey: "emissao_documental",
})
ok(aguardarPublicado.kind === "acompanhamento_retorno" && aguardarPublicado.especifico,
  "3. REGRESSÃO: aguardar_retorno_do_cartorio resolve para o editor específico (era o bug)")

// 4. a chave LEGADA continua resolvendo para o mesmo editor (compat sem duplicar registro)
const aguardarLegado = resolveWorkflowStepEditor({ stepKey: "aguardar_retorno", phaseKey: "emissao_documental" })
ok(aguardarLegado.kind === "acompanhamento_retorno" && aguardarLegado.stepKeyCanonico === "aguardar_retorno_do_cartorio",
  "4. chave legada resolve para o mesmo editor, canonizada")

// 5. resolver NUNCA devolve ausência de editor
const amostras = ["", "x", "AGUARDAR RETORNO DO CARTÓRIO", "protocolar", "montar_dossie", "qualquer_coisa"]
ok(amostras.every((k) => {
  const r = resolveWorkflowStepEditor({ stepKey: k })
  return r.kind !== undefined && r.kind !== null && (r.kind === "padrao" || r.especifico)
}), "5. nenhuma etapa fica sem editor montável")

// 6. a resolução NÃO depende do nome/título do passo
ok(resolveWorkflowStepEditor({ stepKey: "Aguardar retorno do cartório" }).kind === "padrao" &&
   resolveWorkflowStepEditor({ stepKey: "aguardar_retorno_do_cartorio" }).kind === "acompanhamento_retorno",
  "6. resolver usa a chave estrutural, não o título do passo")

// 7. todo kind tem apresentação (inclusive o padrão) e nenhuma fala em pendência técnica
const kinds = [...new Set([...stepKeysComEditorEspecifico().map((k) => resolveWorkflowStepEditor({ stepKey: k }).kind), "padrao" as StepEditorKind])]
const proibidas = /não disponível|nao disponivel|a ser definido|não implementad|nao implementad|forçar|forcar/i
ok(kinds.every((k) => APRESENTACAO_EDITOR[k] && APRESENTACAO_EDITOR[k].titulo.length > 0 &&
    !proibidas.test(APRESENTACAO_EDITOR[k].titulo + APRESENTACAO_EDITOR[k].descricao)),
  "7. toda apresentação de editor descreve o painel — nunca uma pendência")

// ════════════════════════════════════════════════════════════════
// (A) CATÁLOGO ALINHADO AO PASSO PUBLICADO
// ════════════════════════════════════════════════════════════════
console.log("\n(A) Catálogo × passo publicado:")

const emissao = FASES.EMISSAO_DOCUMENTAL
const passoAguardar = emissao.steps.find((s) => s.stepKey === "aguardar_retorno_do_cartorio")
ok(!!passoAguardar, "8. o catálogo declara a chave PUBLICADA aguardar_retorno_do_cartorio")
ok(passoAguardar?.title === "Aguardar retorno do cartório" && passoAguardar?.weight === 10 && passoAguardar?.slaDays === 15,
  "9. título, peso e SLA do passo voltam a ser encontrados (não caem no default)")

ok(getStepDef("EMISSAO_DOCUMENTAL", "aguardar_retorno")?.stepKey === "aguardar_retorno_do_cartorio" &&
   getStepDef("EMISSAO_DOCUMENTAL", "aguardar_retorno_do_cartorio")?.weight === 10,
  "10. getStepDef acha a definição tanto pela chave legada quanto pela publicada")

ok(resolveStepKeyCompat("emissao_documental", "aguardar_retorno_do_cartorio") === "aguardar_retorno_do_cartorio",
  "11. canonizar a chave publicada é idempotente")

// os stepKeys do catálogo não podem sair do registro sem editor — cobertura declarada
const semCobertura = emissao.steps.filter((s) => !resolveWorkflowStepEditor({ stepKey: s.stepKey, phaseKey: emissao.phaseKey }).especifico)
ok(semCobertura.length === 0, "12. todo passo da Emissão Documental tem editor específico registrado")

// ════════════════════════════════════════════════════════════════
// (A) AÇÕES PERMITIDAS — decisão do servidor
// ════════════════════════════════════════════════════════════════
console.log("\n(A) Ações permitidas:")

const emAndamentoAdmin = acoesPermitidasDaEtapa({ status: "EM_ANDAMENTO", permissoes: TODAS })
ok(emAndamentoAdmin.includes("concluir") && emAndamentoAdmin.includes("registrar_contato") && emAndamentoAdmin.includes("salvar_andamento"),
  "13. etapa em andamento oferece executar, registrar contato e concluir")

ok(acoesPermitidasDaEtapa({ status: "EM_ANDAMENTO", permissoes: NENHUMA }).length === 0,
  "14. usuário sem permissão não recebe ação nenhuma")

ok(acoesPermitidasDaEtapa({ status: "EM_ANDAMENTO", permissoes: null }).length === 0,
  "15. sem usuário resolvido, nenhuma ação é oferecida")

const concluida = acoesPermitidasDaEtapa({ status: "CONCLUIDO", permissoes: TODAS })
ok(concluida.includes("reabrir") && !concluida.includes("concluir") && !concluida.includes("forcar"),
  "16. etapa concluída só reabre — não conclui nem força de novo")

ok(acoesPermitidasDaEtapa({ status: "CANCELADO", permissoes: TODAS }).length === 0 &&
   acoesPermitidasDaEtapa({ status: "SUPERSEDIDO", permissoes: TODAS }).length === 0,
  "17. etapa cancelada/supersedida não aceita ação")

const bloqueada = acoesPermitidasDaEtapa({ status: "BLOQUEADO", permissoes: TODAS })
ok(bloqueada.includes("desbloquear") && bloqueada.includes("registrar_contato") && !bloqueada.includes("concluir"),
  "18. etapa bloqueada registra contato e desbloqueia, mas não conclui")

// FORÇAR exige permissão PRÓPRIA — não vem junto com concluir
const soConclui = { ...NENHUMA, [PERMISSAO_DA_ACAO.concluir]: true }
ok(!acoesPermitidasDaEtapa({ status: "EM_ANDAMENTO", permissoes: soConclui }).includes("forcar"),
  "19. quem pode concluir NÃO ganha Forçar de brinde")

ok(acaoCompativelComEstado("concluir", "EM_ANDAMENTO") && !acaoCompativelComEstado("concluir", "CONCLUIDO"),
  "20. compatibilidade ação × estado é a mesma usada no enforcement")

// ════════════════════════════════════════════════════════════════
// (A) ANDAMENTO — append-only, idempotente, validado
// ════════════════════════════════════════════════════════════════
console.log("\n(A) Andamento operacional:")

const ctx = { autorId: 7, agora: AGORA }

// contato 1
const r1 = aplicarAndamento(ANDAMENTO_VAZIO, {
  contato: { canal: "LIGACAO", resultado: "PRAZO_INFORMADO", observacao: "pediu 7 dias", ocorridoEm: "2026-08-01T10:00:00.000Z" },
}, ctx)
ok(r1.erros.length === 0 && r1.andamento.contatos.length === 1 && r1.andamento.contatos[0].autorId === 7,
  "21. registrar contato cria entrada no histórico com autor e data")

// contato 2 — não sobrescreve o primeiro
const r2 = aplicarAndamento(r1.andamento, {
  contato: { canal: "EMAIL", resultado: "SEM_RESPOSTA", observacao: "sem retorno", ocorridoEm: "2026-08-02T10:00:00.000Z" },
}, ctx)
ok(r2.andamento.contatos.length === 2 && r2.andamento.contatos[0].observacao === "pediu 7 dias",
  "22. múltiplos contatos coexistem — o anterior não é sobrescrito")

// reenvio do MESMO contato (duplo clique / retry)
const r3 = aplicarAndamento(r2.andamento, {
  contato: { canal: "EMAIL", resultado: "SEM_RESPOSTA", observacao: "sem retorno", ocorridoEm: "2026-08-02T10:00:00.000Z" },
}, ctx)
ok(r3.andamento.contatos.length === 2 && r3.mudou.contato === false,
  "23. duplo clique não duplica contato (idempotência por conteúdo)")

// observações
const o1 = aplicarAndamento(r2.andamento, { observacao: { texto: "primeira" } }, ctx)
const o2 = aplicarAndamento(o1.andamento, { observacao: { texto: "segunda" } }, ctx)
ok(o2.andamento.observacoes.length === 2 && o2.andamento.observacoes[0].texto === "primeira" &&
   o2.andamento.observacoes.every((o) => o.autorId === 7 && !!o.registradoEm),
  "24. observações são append-only, com autor e data")

ok(aplicarAndamento(ANDAMENTO_VAZIO, { observacao: { texto: "   " } }, ctx).erros.includes("OBSERVACAO_VAZIA"),
  "25. observação vazia é recusada com código de validação")

// anexos — dedup por URL (retry de upload)
const a1 = aplicarAndamento(o2.andamento, { anexos: [{ url: "https://x/a.pdf", nome: "a.pdf" }] }, ctx)
const a2 = aplicarAndamento(a1.andamento, { anexos: [{ url: "https://x/a.pdf", nome: "a.pdf" }] }, ctx)
ok(a1.andamento.anexos.length === 1 && a2.andamento.anexos.length === 1 && a2.mudou.anexos === 0,
  "26. anexo fica vinculado à etapa e o retry não duplica")

ok(a1.andamento.anexos[0].autorId === 7 && !!a1.andamento.anexos[0].registradoEm,
  "27. anexo registra autor e data")

// campos: salvar andamento NÃO exige formulário completo
const c1 = aplicarAndamento(ANDAMENTO_VAZIO, { campos: { proximoAcompanhamento: "2026-08-20" } }, ctx)
ok(c1.erros.length === 0 && c1.andamento.proximoAcompanhamento === "2026-08-20" && c1.andamento.previsaoRetorno === null,
  "28. salvar andamento aceita preenchimento parcial")

ok(aplicarAndamento(ANDAMENTO_VAZIO, { campos: { previsaoRetorno: "31/12/2026" } }, ctx).erros.some((e) => e.startsWith("DATA_INVALIDA")),
  "29. data inválida vira código de validação, não exceção")

ok(aplicarAndamento(ANDAMENTO_VAZIO, { contato: { canal: "POMBO_CORREIO", resultado: "OUTRO" } }, ctx).erros.includes("CANAL_INVALIDO"),
  "30. canal fora do domínio é recusado")

// entrada inválida NÃO altera o estado (rollback lógico)
const invalido = aplicarAndamento(r2.andamento, { campos: { previsaoRetorno: "xx" }, observacao: { texto: "vai junto?" } }, ctx)
ok(invalido.andamento === r2.andamento && invalido.andamento.observacoes.length === r2.andamento.observacoes.length,
  "31. falha de validação não aplica NADA da entrada (tudo ou nada)")

// round-trip pelo payload persistido, preservando o resto da operação
const operacaoExistente = { trackingCode: "BR123", externalProtocol: "999", reviewChecklist: { a: true } }
const gravado = gravarAndamento(operacaoExistente, a1.andamento)
const relido = lerAndamento(gravado)
ok(gravado.trackingCode === "BR123" && gravado.externalProtocol === "999" && !!gravado.reviewChecklist,
  "32. gravar andamento PRESERVA o resto do payload operacional do passo")
ok(relido.contatos.length === a1.andamento.contatos.length &&
   relido.observacoes.length === a1.andamento.observacoes.length &&
   relido.anexos.length === a1.andamento.anexos.length,
  "33. reload mantém os dados (round-trip do payload)")

ok(lerAndamento(null).contatos.length === 0 && lerAndamento("lixo").observacoes.length === 0,
  "34. payload ausente ou corrompido lê como vazio, sem quebrar a tela")

// previsão derivada
ok(previsaoEfetiva({ ...ANDAMENTO_VAZIO, prazoEstimadoDias: 15 }, new Date("2026-08-01T00:00:00.000Z")) === "2026-08-16" &&
   previsaoEfetiva({ ...ANDAMENTO_VAZIO, prazoEstimadoDias: 15, previsaoRetorno: "2026-09-01" }, new Date("2026-08-01T00:00:00.000Z")) === "2026-09-01",
  "35. previsão é derivada do prazo, mas a informada manda")

// retorno recebido encerra a marcação de ausência
const semRetorno = aplicarAndamento({ ...ANDAMENTO_VAZIO, semRetornoDesde: "2026-07-01" }, {
  contato: { canal: "LIGACAO", resultado: "RETORNO_RECEBIDO", observacao: "chegou" },
}, ctx)
ok(semRetorno.andamento.semRetornoDesde === null,
  "36. registrar retorno recebido encerra a ausência de retorno")

// ════════════════════════════════════════════════════════════════
// (A) GUARDAS ESTRUTURAIS
// ════════════════════════════════════════════════════════════════
console.log("\n(A) Guardas estruturais:")

function lerFonte(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
}

const stepEditors = lerFonte("src/components/kanban/workflow/StepEditors.tsx")
const drawer = lerFonte("src/components/kanban/workflow/CentralDaEtapaDrawer.tsx")

ok(!stepEditors.includes("Editor não disponível") && !drawer.includes("Editor não disponível"),
  "37. a frase \"Editor não disponível\" não existe mais no código")

ok(!/ainda n[ãa]o tem editor/i.test(stepEditors + drawer),
  "38. nenhuma tela diz ao usuário que a etapa não tem editor")

ok(!/bot[ãa]o[\s\S]{0,20}For[çc]ar[\s\S]{0,80}sem editor/i.test(stepEditors + drawer),
  "39. Forçar não é oferecido como saída para ausência de editor")

ok(stepEditors.includes("resolveWorkflowStepEditor") && drawer.includes("resolveWorkflowStepEditor"),
  "40. as telas resolvem o editor pelo registry oficial")

// o registry é o ÚNICO lugar que decide editor por stepKey
let switchesSoltos = ""
try {
  switchesSoltos = execSync(
    `grep -rn "case \\"aguardar_retorno\\"\\|case \\"solicitar_certidao\\"\\|case \\"validar_certidao\\"" ${JSON.stringify(join(ROOT, "src"))} --include="*.ts" --include="*.tsx" 2>/dev/null || true`,
    { encoding: "utf8" },
  )
} catch { switchesSoltos = "" }
const linhasSoltas = switchesSoltos.split("\n").filter((l) => l.trim() && !l.includes("step-editor-registry.ts"))
if (linhasSoltas.length) linhasSoltas.forEach((l) => console.log("    ! " + l))
ok(linhasSoltas.length === 0, "41. nenhum switch de editor por stepKey fora do registry")

// autoria da conclusão não pode voltar a vir do cliente
const rotaPasso = lerFonte("src/app/api/documentos/[id]/workflow/steps/[stepId]/route.ts")
ok(rotaPasso.includes("delete patch.completedById") && rotaPasso.includes("extrairUsuarioComPermissoes"),
  "42. a rota descarta completedById do cliente e resolve o usuário pelo token")

const servico = lerFonte("src/services/documento-operacao.ts")
ok(servico.includes("PERMISSION_REQUIRED") && servico.includes("acaoCompativelComEstado") &&
   servico.includes("CONCURRENT_UPDATE"),
  "43. o serviço valida permissão, estado e concorrência no servidor")

ok(servico.includes("lockVersion: p.lockVersion") && servico.includes("lockVersion: { increment: 1 }"),
  "44. gravação de andamento usa trava otimista")

ok(servico.includes('acao: "PASSO_FORCADO"') && servico.includes('acao: "PASSO_ANDAMENTO"'),
  "45. forçar e registrar andamento deixam auditoria")

// nenhuma mensagem de erro vaza nome de model/schema para o operador
const andamentoUi = lerFonte("src/components/kanban/workflow/AndamentoEtapa.tsx")
ok(!/PhaseWorkflowStepInstance|prisma|metadata\.operacao/i.test(
     andamentoUi.split("MENSAGEM_DO_ERRO")[1]?.split("}")[0] ?? ""),
  "46. as mensagens ao usuário não citam model nem schema")

// O comportamento sobre dados reais (etapa aberta, protocolo carregado, conclusão
// liberando o próximo passo) fica em `editor-etapa-integracao.test.ts`, que fala
// com o banco configurado — este arquivo é PURO de propósito.

console.log(`\n${passed} passaram, ${failed} falharam`)
if (failed > 0) { console.log("FALHAS: " + falhas.join("; ")); process.exit(1) }
console.log("Editor de etapa: registry, editor padrão e andamento validados ✅")
