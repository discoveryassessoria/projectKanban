// scripts/central-pessoas-tarefas.test.ts
//
// TRAVA a arquitetura da Central Operacional corrigida nesta sessão:
//
//  (A) COMPORTAMENTO — núcleo puro (central-operacional-core):
//      as pessoas vêm do vínculo com a árvore e são classificadas por relação real;
//      nenhuma pessoa é descartada; a régua status-do-passo → balde é única.
//
//  (B) BLINDAGEM ESTÁTICA — a regressão que causou "0 pessoa(s)" e "tarefa que não
//      abre" não pode voltar: a lista de pessoas não pode ser derivada da fila, a
//      lista de tarefas tem de existir, e nenhuma condição de quantidade/documento
//      obrigatório pode governar a renderização.
//
// Falha ⇒ quebra o build/CI.

import { readFileSync } from "fs"
import { join } from "path"
import {
  montarPessoasDoProcesso,
  baldeDoPasso,
  rotuloStatusPasso,
  type PessoaBruta,
  type UniaoBruta,
} from "../src/lib/process-stage/central-operacional-core"

const ROOT = join(__dirname, "..")
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean) {
  if (cond) { ok++; console.log(`  ✅ ${nome}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}`) }
}

// ============================================================
// (A) NÚCLEO PURO — pessoas do processo
// ============================================================
console.log("\n(A) Roster de pessoas — vínculo com a árvore, nunca a fila")

// Árvore real do processo DE-21 em produção (o caso que exibia "0 pessoa(s)").
const REQUERENTE: PessoaBruta = { id: 2590, nome: "Marco", sobrenome: "Antonio Rovatti", sexo: "M", publicCode: null, requerente: "maior", linhaReta: true, numeroLinhagem: null, paiId: 2591, maeId: 2592 }
const PAI: PessoaBruta = { id: 2591, nome: "Joao", sobrenome: "Silva", sexo: "M", publicCode: null, requerente: "nao", linhaReta: true, numeroLinhagem: null, paiId: null, maeId: null }
const MAE: PessoaBruta = { id: 2592, nome: "Tereza", sobrenome: "Silva", sexo: "F", publicCode: null, requerente: "nao", linhaReta: false, numeroLinhagem: null, paiId: null, maeId: null }
const UNIAO: UniaoBruta = { id: 953, pessoa1Id: 2592, pessoa2Id: 2591 }

const roster = montarPessoasDoProcesso([REQUERENTE, PAI, MAE], [UNIAO])
const por = (id: number) => roster.find((r) => r.pessoaId === id)!

check("nenhuma pessoa da árvore é descartada", roster.length === 3)
check("SEM documento, SEM necessidade e SEM tarefa o roster continua completo", roster.length === 3)
check("requerente entra na linha principal", por(2590).classificacao === "LINHA_PRINCIPAL")
check("requerente é reconhecido pelo flag oficial ('maior')", por(2590).requerente === true)
check("requerente é a geração 0", por(2590).geracao === 0)
check("pai (linha reta, ascendente direto) entra na linha principal", por(2591).classificacao === "LINHA_PRINCIPAL")
check("posição do pai vem do motor de parentesco", por(2591).posicao === "pai")
check("pai é a geração 1", por(2591).geracao === 1)
check("mãe declarada fora da linha reta fica em 'fora da linhagem'", por(2592).classificacao === "FORA_DA_LINHAGEM")
check("mãe NÃO é excluída da Central", por(2592) != null)
check("posição da mãe é nomeada mesmo fora da linha", por(2592).posicao === "mãe")
check("ordem respeita a sequência genealógica (requerente primeiro)", roster[0].pessoaId === 2590 && roster[1].pessoaId === 2591)
check("iniciais derivadas do nome completo", por(2590).iniciais === "MA")

// Inconsistência REAL: declarada na linha reta, sem filiação até o requerente.
const SOLTA: PessoaBruta = { id: 9001, nome: "Pessoa", sobrenome: "Solta", sexo: null, publicCode: null, requerente: "nao", linhaReta: true, numeroLinhagem: null, paiId: null, maeId: null }
const comSolta = montarPessoasDoProcesso([REQUERENTE, PAI, MAE, SOLTA], [UNIAO])
const solta = comSolta.find((r) => r.pessoaId === 9001)!
check("pessoa na linha reta sem vínculo vira PENDENTE_CLASSIFICACAO", solta.classificacao === "PENDENTE_CLASSIFICACAO")
check("pendência é explicada, não silenciosa", !!solta.pendencia && solta.pendencia.length > 10)
check("pessoa pendente continua no roster", comSolta.length === 4)

// Árvore sem requerente marcado: ninguém pode ser posicionado — e ninguém some.
const semReq = montarPessoasDoProcesso(
  [{ ...REQUERENTE, requerente: "nao" }, PAI, MAE],
  [UNIAO],
)
check("sem requerente marcado nenhuma pessoa é descartada", semReq.length === 3)
check("sem requerente a pendência aponta a causa", semReq.some((r) => (r.pendencia ?? "").includes("requerente")))
check("mesmo sem requerente, quem está fora da linha reta segue classificado", semReq.find((r) => r.pessoaId === 2592)!.classificacao === "FORA_DA_LINHAGEM")

check("árvore vazia devolve roster vazio (sem exceção)", montarPessoasDoProcesso([], []).length === 0)

// ============================================================
// (A2) NÚCLEO PURO — baldes de tarefa
// ============================================================
console.log("\n(A2) Régua única status-do-passo → balde operacional")
check("CONCLUIDO → Concluídas", baldeDoPasso("CONCLUIDO") === "CONCLUIDA")
check("EXECUTADO → Concluídas", baldeDoPasso("EXECUTADO") === "CONCLUIDA")
check("DISPENSADO → Concluídas", baldeDoPasso("DISPENSADO") === "CONCLUIDA")
check("EM_ANDAMENTO → Em andamento", baldeDoPasso("EM_ANDAMENTO") === "EM_ANDAMENTO")
check("AGUARDANDO → Em andamento", baldeDoPasso("AGUARDANDO") === "EM_ANDAMENTO")
check("AGUARDANDO_APROVACAO → Em andamento", baldeDoPasso("AGUARDANDO_APROVACAO") === "EM_ANDAMENTO")
check("DISPONIVEL → Pendentes (trabalho por fazer)", baldeDoPasso("DISPONIVEL") === "PENDENTE")
check("PENDENTE → Pendentes", baldeDoPasso("PENDENTE") === "PENDENTE")
check("BLOQUEADO → Pendentes, com rótulo próprio preservado", baldeDoPasso("BLOQUEADO") === "PENDENTE" && rotuloStatusPasso("BLOQUEADO") === "Bloqueado")
check("status desconhecido não vira 'concluída' por engano", baldeDoPasso("XPTO") === "PENDENTE")

// ============================================================
// (B) BLINDAGEM ESTÁTICA
// ============================================================
console.log("\n(B) A regressão não pode voltar")

const rota = read("src/app/api/processos/[processoId]/central-operacional/route.ts")
const central = read("src/components/kanban/ProcessoCentralOperacional.tsx")
const painel = read("src/components/kanban/PainelDaFase.tsx")
const consulta = read("src/lib/process-stage/estrutura-operacional.ts")
const nucleo = read("src/lib/process-stage/estrutura-operacional-core.ts")
const wtab = read("src/components/kanban/workflow/WorkflowTab.tsx")
const opa = read("src/components/kanban/workflow/OperacaoAntecipadaPainel.tsx")

check("rota devolve o roster oficial de pessoas", /pessoas:\s*pessoasDoProcesso/.test(rota))
check("rota devolve o ÍNDICE da fase (pessoa → documento)", /^\s*indice,\s*$/m.test(rota))
check("pessoas vêm do vínculo com a árvore (Pessoa.arvoreId)", /prisma\.pessoa\.findMany\(\{\s*\n?\s*where:\s*\{\s*arvoreId:\s*processo\.arvoreId\s*\}/.test(rota))
check("roster é montado pelo núcleo puro (fonte única)", rota.includes("montarPessoasDoProcesso(pessoas, unioes)"))
check("o trabalho vem de PhaseWorkflowStepInstance da fase", consulta.includes("phaseWorkflowStepInstance.findMany") && consulta.includes("faseMacroKey: ctx.faseMacroKey"))
check("a régua única de balde continua sendo a mesma", nucleo.includes("baldeDoPasso"))
check("etapa sem item aplicável NÃO se declara 'em andamento'", rota.includes('totalObrig === 0 ? "pendente"'))

check("Central recebe o roster e o índice prontos do backend", central.includes("pessoas?: PessoaDoProcessoUI[]") && central.includes("indice?: IndiceOperacional"))
check("Central expõe o grupo 'pendente de classificação'", painel.includes("pendenteClassificacao"))
check("pessoa aparece com ou sem documento aplicável", painel.includes("Nenhum documento aplicável nesta fase"))
check("Central repassa o índice ao painel", central.includes("indice={bodyData.indice"))
check("Central tem handler único de abertura de detalhes", central.includes("const abrirDetalhes = useCallback"))
check("abrir detalhes usa a operação oficial (sem rota legada)", /abrirOperacao\(doc\.documentoId \?\? 0, doc\.necessidadeId\)/.test(central))
check("documento sem executor vira erro administrativo explícito (linha não some)", central.includes("if (!doc.podeAbrirDetalhes)") && painel.includes("doc.impedimento") && painel.includes("Sem executor"))
check("contador e lista têm a MESMA fonte (resumo do índice)", central.includes("data.indice?.resumo"))

check("painel é ÍNDICE: pessoa em card, documento em linha", painel.includes("function PessoaCard") && painel.includes("function LinhaDocumento") && !painel.includes("function PassoRow"))
check("pessoa é expansível e revela os documentos dela", painel.includes("alternar()") && painel.includes("abertos.has(`pessoa:"))
check("o workflow do documento vive no MODAL, não no painel", !painel.includes("doc.passos") && read("src/components/kanban/workflow/WorkflowTab.tsx").includes("workflow.steps.map"))
check("sem lista de tarefas paralela ao workflow", !painel.includes("ListaDeTarefas") && !painel.includes("GRUPOS_TAREFA"))
check("sem agregado por passo misturando as pessoas", !painel.includes("function WorkflowDaFase") && !painel.includes("function PassoDoWorkflow"))
check("sem esteira de etapas duplicando o workflow", !painel.includes("5 ETAPAS EM LINHA") && !central.includes("let steps: FaseStep[]"))
check("painel tem o grupo de pendência de classificação", painel.includes("Pendente de classificação"))

// A regressão exata: condições de quantidade/obrigatoriedade governando renderização.
const CONDICOES_PROIBIDAS: Array<[string, RegExp]> = [
  ["tarefas.length > 1 governando exibição", /tarefas\.length\s*>\s*1/],
  ["tasks.length > 1", /tasks\.length\s*>\s*1/],
  ["docs.length > 1", /docs\.length\s*>\s*1/],
  ["mandatoryDocuments.length > 0", /mandatoryDocuments\.length\s*>\s*0/],
  ["phaseProgress > 0 governando exibição", /phaseProgress\s*>\s*0/],
  ["legacyTaskRoute", /legacyTaskRoute/],
]
for (const [nome, re] of CONDICOES_PROIBIDAS) {
  check(`sem condição incorreta: ${nome}`, !re.test(central) && !re.test(painel) && !re.test(rota))
}
// O trabalho aparece UMA vez: dentro do documento a que pertence. Nem a linha da
// pessoa nem um agregado por passo podem repetir a mesma instância.
check("a execução é desenhada em UM lugar só (o modal)",
  !painel.includes("p.docs.map") && !painel.includes("docsResumo.map") && !/\.passos\.map/.test(painel))
// OPERAÇÃO ANTECIPADA — a capacidade tem de continuar INTEIRA: criar, listar,
// avaliar e abrir. Ela pertence ao ALVO, e é no documento que o alvo aparece.
check("antecipada: criar (no modal)", wtab.includes("nova operação antecipada") && wtab.includes("OperacaoAntecipadaModal"))
check("antecipada: listar inline no alvo (no modal)", opa.includes("export function OperacoesAntecipadasInline") && wtab.includes("<OperacoesAntecipadasInline"))
check("antecipada: avaliar (SIM/PARCIAL/NAO/CANCELAR)", opa.includes("function OperacaoAntecipadaItem") && opa.includes("onAvaliar?.(o.id"))
check("antecipada: abrir a operação oficial", wtab.includes("onAbrirOperacaoAlvo") && central.includes("const abrirOperacaoAlvo = useCallback"))
check("antecipada: rótulos de status preservados", opa.includes("ST_OP_LABEL") && opa.includes("AGUARDANDO_RESULTADO"))
check("antecipada: a Central passa o ALVO ao modal, e só", central.includes("contextoAntecipada={") && !central.includes("operacoesPorNec"))

// Timeline: executar a tarefa pela Central tem de deixar rastro no Diário Operacional.
const opDoc = read("src/services/documento-operacao.ts")
check("operação por-documento emite evento do motor (timeline)", opDoc.includes("tx.workflowEvento.createMany") && opDoc.includes("EVENTO_POR_STATUS"))
check("evento cobre início, mudança de status e conclusão", /EM_ANDAMENTO:\s*"PASSO_INICIADO"/.test(opDoc) && /CONCLUIDO:\s*"PASSO_CONCLUIDO"/.test(opDoc) && /BLOQUEADO:\s*"PASSO_BLOQUEADO"/.test(opDoc))
check("evento é idempotente (não derruba a transação ao repetir)", opDoc.includes("skipDuplicates: true") && opDoc.includes("chaveEvento("))
check("sem evento quando não houve transição de estado", opDoc.includes("novo === p.status ? null"))
check("um documento aparece igual com 1 ou com 5 passos (sem piso de quantidade)", !/passos\.length\s*>\s*1/.test(painel) && !/steps\.length\s*>\s*1/.test(wtab))
check("a aba Workflow mostra TODOS os passos (sem filtro que esconde futuros)", wtab.includes("workflow.steps.map") && !/steps\s*\.filter\(\(step\)/.test(wtab))

// ============================================================
console.log(`\n${falhas.length === 0 ? "✅" : "❌"} ${ok}/${ok + falhas.length} verificações`)
if (falhas.length) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
