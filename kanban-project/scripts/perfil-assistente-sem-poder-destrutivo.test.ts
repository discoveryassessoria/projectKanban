// scripts/perfil-assistente-sem-poder-destrutivo.test.ts
// ============================================================================
// REGRA PERMANENTE: Assistente EXECUTA operação. Não GOVERNA, CANCELA,
// INVALIDA, BLOQUEIA administrativamente, EXCLUI nem DESTRÓI estrutura do
// processo, workflow, árvore, documentos ou estado administrativo da operação.
//
// Achado real (11/09/2026, relato da Daniela): o perfil "Assistente" em
// PRODUÇÃO (tabela Perfil) estava DESSINCRONIZADO do template canônico em
// src/lib/permissoes.ts havia tempo — `arvore.excluir_documento: true`
// (deveria ser false) e faltavam permissões OPERACIONAIS que o próprio código
// já concedia (workflow.iniciarPasso/concluirPasso, clientes.criar/editar,
// processos.criar/editar...). O sintoma era um usuário com override individual
// amplo (`Usuario.permissoesCustom`) compensando o que o perfil deveria dar —
// e, como efeito colateral, também ganhando `tarefas.excluir`/outras
// exclusões que o perfil Assistente nunca deveria ter.
//
// Este guard trava o TEMPLATE (a fonte usada para sincronizar a linha real do
// banco — scripts/_tmp, não versionado — e para semear/`resetar` o perfil).
// Não substitui a sincronização em produção: só garante que o código nunca
// mais volte a definir um "Assistente" com poder destrutivo/administrativo.
//
//   npx tsx scripts/perfil-assistente-sem-poder-destrutivo.test.ts
// ============================================================================
import { readFileSync } from "fs"
import { PERFIS_PADRAO, calcularPermissoes, type PermissaoChave } from "../src/lib/permissoes"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

console.log("PERFIL ASSISTENTE — executa operação, não governa nem destrói\n")

const assistente = PERFIS_PADRAO.find((p) => p.nome === "Assistente")
check("0) o perfil 'Assistente' existe no template canônico", assistente != null)
if (!assistente) { console.log("\nParando: sem o perfil não há o que verificar."); process.exit(1) }

// Permissões efetivas do perfil puro — sem override individual, sem ser admin.
const efetivas = calcularPermissoes("assistente", assistente.permissoes as Record<string, boolean>, null)

secao("1) SEM PODER DESTRUTIVO/ADMINISTRATIVO — a lista explícita do relato da Daniela")
const PROIBIDAS: { chave: PermissaoChave; acao: string }[] = [
  { chave: "tarefas.excluir", acao: "Cancelar/Invalidar operação (PERMISSAO_DO_CONTROLE)" },
  { chave: "tarefas.bloquear", acao: "Pausar/Retomar operação administrativamente" },
  { chave: "processos.excluir", acao: "Excluir processo" },
  { chave: "processos.excluir_coluna", acao: "Excluir coluna de processo" },
  { chave: "clientes.excluir", acao: "Excluir cliente/contratante/requerente" },
  { chave: "arvore.excluir", acao: "Excluir pessoa/requerente da árvore" },
  { chave: "arvore.excluir_documento", acao: "Excluir documento da árvore genealógica (achado real — estava TRUE em produção)" },
  { chave: "workflow.avancar", acao: "Avançar fase manualmente" },
  { chave: "workflow.retornarFase", acao: "Retroceder fase (retorno controlado)" },
  { chave: "workflow.forcarAvanco", acao: "Forçar avanço de fase" },
  { chave: "workflow.reabrirFase", acao: "Reabrir fase / novo ciclo" },
  { chave: "workflow.ativarV2", acao: "Ativar runtime v2 (operação administrativa)" },
  { chave: "workflow.aprovarPasso", acao: "Aprovar passo do workflow (decisão, não execução)" },
  { chave: "workflow.dispensarPasso", acao: "Dispensar passo do workflow (decisão)" },
  { chave: "workflow.cancelarPasso", acao: "Cancelar passo do workflow" },
  { chave: "workflow.supersederPasso", acao: "Superseder passo do workflow" },
  { chave: "workflow.gerarTarefa", acao: "Distribuir/gerar tarefa de outra pessoa" },
  { chave: "tarefas.editar", acao: "Editar/atribuir tarefa alheia" },
  { chave: "usuarios.gerenciar", acao: "Gerenciar usuários" },
  { chave: "usuarios.criar", acao: "Criar usuário" },
  { chave: "usuarios.editar", acao: "Editar usuário" },
  { chave: "usuarios.excluir", acao: "Excluir usuário" },
  { chave: "registral.aprovar", acao: "Aprovar correção registral" },
  { chave: "registral.alterar_filiacao", acao: "Alterar filiação (estrutura da árvore)" },
  { chave: "registral.reverter", acao: "Reverter alteração registral aplicada" },
  { chave: "registral.administrar_regras", acao: "Administrar regras registrais" },
  { chave: "modelos.gerenciar", acao: "Gerenciar modelo documental" },
  { chave: "modelos.publicar", acao: "Publicar modelo documental" },
  { chave: "modelos.revogar", acao: "Revogar modelo documental" },
  { chave: "regras_documentais.publicar", acao: "Publicar regra documental" },
  { chave: "regras_documentais.excluir", acao: "Excluir regra documental" },
  { chave: "financeiro.custo_aprovar", acao: "Aprovar custo" },
  { chave: "financeiro.custo_cancelar", acao: "Cancelar custo" },
  { chave: "financeiro.custo_excluir", acao: "Excluir custo" },
]
for (const { chave, acao } of PROIBIDAS) {
  check(`${chave} = false (${acao})`, efetivas[chave] === false)
}
// As duas permissões EXCLUSIVAS nunca vêm por perfil padrão nenhum — reforça
// que a régua "moverFaseManual"/"regularizarHistorico" continua fora do alcance.
check("processos.moverFaseManual = false (exclusiva — nunca vem por perfil)", efetivas["processos.moverFaseManual"] === false)
check("processos.regularizarHistorico = false (exclusiva — nunca vem por perfil)", efetivas["processos.regularizarHistorico"] === false)

secao("2) MANTÉM O TRABALHO OPERACIONAL NORMAL — a régua não pode confundir 'destrutivo' com 'executar'")
const OPERACIONAIS: PermissaoChave[] = [
  "tarefas.ver", "tarefas.criar", "tarefas.iniciar_concluir",
  "workflow.iniciarPasso", "workflow.concluirPasso",
  "processos.ver", "processos.ver_paginas",
  "arvore.ver", "arvore.criar", "arvore.editar", "arvore.criar_documento", "arvore.editar_documento",
  "clientes.ver", "clientes.criar", "clientes.editar",
  "registral.ver_evidencias", "registral.revisar", "registral.reprocessar",
  "financeiro.custo_criar", "financeiro.custo_editar", "financeiro.custo_arquivar",
]
for (const chave of OPERACIONAIS) {
  check(`${chave} = true (trabalho do dia a dia)`, efetivas[chave] === true)
}

secao("3) O SERVIDOR é quem trava de verdade — cada ação proibida tem enforcement na rota, não só no perfil")
const rotas: { arquivo: string; permissao: string }[] = [
  { arquivo: "src/app/api/documentos/[id]/workflow/route.ts", permissao: "PERMISSAO_DO_CONTROLE" },
  { arquivo: "src/app/api/processos/[processoId]/route.ts", permissao: "processos.excluir" },
  { arquivo: "src/app/api/requerentes/[id]/route.ts", permissao: "clientes.excluir" },
  { arquivo: "src/app/api/contratantes/[contratanteId]/route.ts", permissao: "clientes.excluir" },
  { arquivo: "src/app/api/pessoas/[id]/route.ts", permissao: "arvore.excluir" },
  { arquivo: "src/app/api/documentos/[id]/route.ts", permissao: "arvore.excluir_documento" },
  { arquivo: "src/app/api/processos/[processoId]/advance/route.ts", permissao: "workflow.avancar" },
  { arquivo: "src/app/api/processos/[processoId]/advance/force/route.ts", permissao: "workflow.forcarAvanco" },
  { arquivo: "src/app/api/processos/[processoId]/phase/return/route.ts", permissao: "workflow.retornarFase" },
  { arquivo: "src/app/api/processos/[processoId]/phase/reopen/route.ts", permissao: "workflow.reabrirFase" },
  { arquivo: "src/app/api/processos/[processoId]/phase/move/route.ts", permissao: "processos.moverFaseManual" },
]
for (const r of rotas) {
  let conteudo = ""
  try { conteudo = readFileSync(r.arquivo, "utf8") } catch { /* arquivo pode não existir mais */ }
  check(`${r.arquivo} confere ${r.permissao}`, conteudo.includes(r.permissao))
}

console.log(`\n${ok} passaram, ${falhas.length} falharam`)
if (falhas.length) console.log("Falhas:", falhas.join(", "))
process.exit(falhas.length > 0 ? 1 : 0)
