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

check("rota devolve o roster oficial de pessoas", /pessoas:\s*pessoasDoProcesso/.test(rota))
check("rota devolve a lista de tarefas da fase", /\btarefas,\s*$/m.test(rota) || rota.includes("tarefas,\n"))
check("pessoas vêm do vínculo com a árvore (Pessoa.arvoreId)", /prisma\.pessoa\.findMany\(\{\s*\n?\s*where:\s*\{\s*arvoreId:\s*processo\.arvoreId\s*\}/.test(rota))
check("roster é montado pelo núcleo puro (fonte única)", rota.includes("montarPessoasDoProcesso(pessoas, unioes)"))
check("tarefas vêm de PhaseWorkflowStepInstance da fase", rota.includes("passosDaFase") && rota.includes("phaseWorkflowStepInstance.findMany"))
check("tarefas usam a régua única de balde", rota.includes("baldeDoPasso(s.status)"))
check("etapa sem item aplicável NÃO se declara 'em andamento'", rota.includes('totalObrig === 0 ? "pendente"'))

check("Central semeia as linhas pelo roster, não pela fila", central.includes("const roster = data.pessoas ?? []") && central.includes("for (const r of roster) porPessoa.set(r.pessoaId, linhaDoRoster(r))"))
check("Central expõe o grupo 'pendente de classificação'", central.includes("pendenteClassificacao"))
check("Central repassa as tarefas ao painel", central.includes("tarefas={bodyData.tarefas ?? []}"))
check("Central tem handler único de abertura de tarefa", central.includes("const abrirTarefa = useCallback"))
check("abrir tarefa usa a operação oficial (sem rota legada)", /abrirOperacao\(t\.documentoId \?\? 0, t\.necessidadeId\)/.test(central))
check("passo sem executor vira erro administrativo explícito (tarefa não some)", central.includes("if (!t.executor)") && painel.includes("erroAdministrativo") && painel.includes("Sem executor"))
check("progresso da fase por alvo sai da MESMA lista de tarefas", central.includes("const porAlvo = tarefasFase.length > 0") && central.includes('label: "Registros a localizar"'))

check("painel renderiza a lista de tarefas", painel.includes("<ListaDeTarefas") && painel.includes("function ListaDeTarefas"))
check("painel agrupa em Pendentes / Em andamento / Concluídas", painel.includes('titulo: "Pendentes"') && painel.includes('titulo: "Em andamento"') && painel.includes('titulo: "Concluídas"'))
check("painel tem o grupo de pendência de classificação", painel.includes("Pendente de classificação"))
check("etapa 'pendente' é rotulada com honestidade", painel.includes("Sem itens aplicáveis"))

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
check("botão 'Abrir' da pessoa não é morto (não depende de docs.length)", !painel.includes("p.docs.length && (setExp(true))"))

// Timeline: executar a tarefa pela Central tem de deixar rastro no Diário Operacional.
const opDoc = read("src/services/documento-operacao.ts")
check("operação por-documento emite evento do motor (timeline)", opDoc.includes("tx.workflowEvento.createMany") && opDoc.includes("EVENTO_POR_STATUS"))
check("evento cobre início, mudança de status e conclusão", /EM_ANDAMENTO:\s*"PASSO_INICIADO"/.test(opDoc) && /CONCLUIDO:\s*"PASSO_CONCLUIDO"/.test(opDoc) && /BLOQUEADO:\s*"PASSO_BLOQUEADO"/.test(opDoc))
check("evento é idempotente (não derruba a transação ao repetir)", opDoc.includes("skipDuplicates: true") && opDoc.includes("chaveEvento("))
check("sem evento quando não houve transição de estado", opDoc.includes("novo === p.status ? null"))
check("lista de tarefas aparece com UMA tarefa (sem piso de quantidade)", !/tarefas\.length\s*>\s*1/.test(painel))
check("tarefas concluídas continuam visíveis (grupo próprio, sem filtro)", painel.includes('balde: "CONCLUIDA"'))

// ============================================================
console.log(`\n${falhas.length === 0 ? "✅" : "❌"} ${ok}/${ok + falhas.length} verificações`)
if (falhas.length) {
  console.log("\nFalhas:")
  for (const f of falhas) console.log(`  · ${f}`)
  process.exit(1)
}
