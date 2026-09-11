// scripts/workflow-controls-permissao.test.ts
// ============================================================================
// BOTÃO PAUSAR/CANCELAR/INVALIDAR SÓ APARECE PARA QUEM PODE.
//
// Achado real (relato da Daniela, ASSISTENTE, 11/09/2026): ela via e conseguia
// clicar em "Cancelar operação"/"Invalidar operação" mesmo sendo assistente.
// Investigado: o SERVIDOR já confere corretamente (PERMISSAO_DO_CONTROLE em
// src/services/documento-operacao.ts, via ctx.permissoes) — Daniela tem um
// override individual (`Usuario.permissoesCustom`) que concede `tarefas.excluir`
// acima do perfil "Assistente" (isso é dado de cadastro, não bug de código; ver
// o relatório de entrega para a pergunta que só o Gerenciamento responde). O que
// NÃO existia era o espelho no FRONTEND: WorkflowControls.tsx desenhava os
// quatro botões incondicionalmente, sem saber de permissão nenhuma — para
// QUALQUER usuário sem o override, os botões apareceriam do mesmo jeito e
// dariam 403 ao clicar. Esconder o botão é desenho, não controle de acesso
// (o servidor CONTINUA sendo quem trava de verdade) — mas uma tela que oferece
// uma ação que ela sabe que vai negar é uma tela mentindo sobre o que a pessoa
// pode fazer.
//
// Este guard é ESTÁTICO (lê o código-fonte) — mesmo padrão de outros guards
// desta suíte — porque não há harness de renderização React nos scripts de
// teste deste repositório.
//
//   npx tsx scripts/workflow-controls-permissao.test.ts
// ============================================================================
import { readFileSync } from "fs"

let ok = 0
const falhas: string[] = []
function check(nome: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)
const read = (p: string) => readFileSync(p, "utf8")

const controls = read("src/components/kanban/WorkflowControls.tsx")
const drawer = read("src/components/kanban/DocumentoOperationalDrawer.tsx")
const docop = read("src/services/documento-operacao.ts")

console.log("WORKFLOWCONTROLS — os botões respeitam a MESMA permissão que o servidor confere\n")

secao("1) A permissão exigida pelo SERVIDOR é a fonte — este guard só confirma que o frontend a espelha")
check("1a) pausar/retomar exigem tarefas.bloquear no servidor", /pausar:\s*"tarefas\.bloquear"/.test(docop) && /retomar:\s*"tarefas\.bloquear"/.test(docop))
check("1b) cancelar/invalidar exigem tarefas.excluir no servidor", /cancelar:\s*"tarefas\.excluir"/.test(docop) && /invalidar:\s*"tarefas\.excluir"/.test(docop))
check("1c) o servidor confere de verdade (não é decoração) — ctx.permissoes?.[chave] !== true", docop.includes("ctx.permissoes?.[chave] !== true"))

secao("2) WorkflowControls.tsx recebe a permissão e esconde o que a pessoa não pode fazer")
check("2a) o componente aceita podeBloquear/podeExcluir como props", /podeBloquear\?:\s*boolean/.test(controls) && /podeExcluir\?:\s*boolean/.test(controls))
check("2b) 'Pausar operação' só renderiza com podeBloquear", /isAndamento && podeBloquear && \([\s\S]{0,700}Pausar operação/.test(controls))
check("2c) 'Retomar operação' só renderiza com podeBloquear", /isPausado && podeBloquear && \([\s\S]{0,700}Retomar operação/.test(controls))
check("2d) 'Cancelar operação' só renderiza com podeExcluir", /\{podeExcluir && \([\s\S]{0,700}Cancelar operação/.test(controls))
check("2e) 'Invalidar operação' só renderiza com podeExcluir", /isAndamento && podeExcluir && \([\s\S]{0,700}Invalidar operação/.test(controls))

secao("3) O DRAWER passa a permissão REAL do usuário logado — nunca `true` fixo")
check("3a) o drawer chama WorkflowControls com podeBloquear/podeExcluir", /<WorkflowControls[\s\S]{0,300}podeBloquear=\{pode\("tarefas\.bloquear"\)\}/.test(drawer))
check("3b) e com podeExcluir vindo da MESMA fonte (pode(), não um valor fixo)", /<WorkflowControls[\s\S]{0,340}podeExcluir=\{pode\("tarefas\.excluir"\)\}/.test(drawer))
check("3c) `pode` vem de usePermissoes() — permissão efetiva do usuário logado, não um cadastro estático no componente", drawer.includes("usePermissoes()"))

console.log(`\n${ok} passaram, ${falhas.length} falharam`)
if (falhas.length) console.log("Falhas:", falhas.join(", "))
process.exit(falhas.length > 0 ? 1 : 0)
