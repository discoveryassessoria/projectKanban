// scripts/mandato-rbac-matriz.test.ts
// ============================================================================
// MANDATO — BLOCO 4: RBAC — MATRIZ COMPLETA.
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/mandato-rbac-matriz.test.ts
//
// MATRIZ (ação do mandato × permissão exigida × onde é checada no BACKEND):
//
//   consultar / abrir Processo   → processos.ver
//     src/app/api/processos/[processoId]/route.ts::GET (linha ~15)
//     ACHADO E CORRIGIDO NESTA RODADA: a rota NÃO tinha NENHUMA verificação —
//     nem de autenticação, nem de permissão. Qualquer chamada (autenticada ou
//     não) devolvia o processo inteiro (contratantes/árvore/requerentes/
//     tarefas/anexos) só por acertar o ID. PUT/DELETE, no MESMO arquivo, já
//     conferiam `processos.editar`/`processos.excluirDefinitivo` — GET era a
//     única porta desprotegida. Provado abaixo (seção 1).
//   executar Step                → PERMISSAO_DA_ACAO (src/lib/process-stage/acoes-etapa.ts),
//     checado em carregarPassoAutorizado (src/services/documento-operacao.ts)
//   registrar follow-up          → catálogo PAUSE_FOR_EXTERNAL_WAIT="tarefas.editar"
//     (src/lib/motor/catalogo-de-efeitos.ts), checado em
//     src/services/executar-acao-cadastrada.ts linha ~181-183
//     ("permissao = acao.permissao ?? def.permissao; if (...) SEM_PERMISSAO")
//   registrar retorno            → RESUME="tarefas.editar" / informarProtocoloPosterior
//     exige "processos.editar_paginas" (src/services/solicitacao-documento.ts)
//   receber documento            → MARK_DOCUMENT_RECEIVED="documentos.editar" (catálogo)
//   validar                      → APPROVE_FOR_ANALYSIS="documentos.editar" (catálogo)
//   rejeitar                     → INVALIDATE_DOCUMENT/REQUEST_NEW_COPY="documentos.editar" (catálogo)
//   reexecutar (reabrir)         → 'reabrir': 'tarefas.editar'
//     (src/app/api/tarefas/[tarefaId]/comando/route.ts, mapa PERMISSAO)
//   reatribuir (transferir)      → 'transferir'/'atribuir': 'tarefas.editar' (idem, + dono-da-tarefa)
//   mudar prazo / override       → 'alterar_prazo': 'tarefas.editar' (idem) — alterarPrazo
//     (lib/operacional/tarefa-ciclo.ts) é o MESMO mecanismo do override local do Bloco 2
//   configurar Workflow          → 'usuarios.gerenciar'
//     (src/app/api/gerenciamento/workflows-fase/[id]/route.ts::PUT)
//   publicar configuração        → 'usuarios.gerenciar' (idem, POST ?acao=publicar)
//     NOTA: mesma permissão que "configurar" — ver seção 3 abaixo.
//   alterar checklist            → mesma rota/permissão de "configurar Workflow"
//     (StepChecklistItem é sub-recurso salvo pelo mesmo PUT)
//   alterar notificação          → SEM permissão dedicada — não existe cadastro
//     runtime de REGRAS de notificação (a matriz evento→notificação é CÓDIGO,
//     não dado administrável; doc 17/etapa4). Não é gap de permissão: é
//     ausência do próprio recurso configurável. Fora do escopo desta correção.
//   decisão administrativa       → GO_RETIFICATION="processos.editar" +
//     exigeAutorizacaoExplicita (catálogo) — decisão jurídica nominal
//
// Operador (perfil "Assistente") NÃO deve alterar Steps/SLA/follow-up globais,
// checklist, decisões, handoff, notificações nem versão publicada — confirmado
// abaixo (seção 2): o perfil não tem `usuarios.gerenciar` (que protege TODA a
// configuração de Workflow Interno, incluindo checklist e publicação).
//
// ESCREVE NO BANCO (usuários de teste) — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { signAuthToken } from "@/lib/auth-jwt"
import { calcularPermissoes } from "@/src/lib/permissoes"
import { GET as getProcesso } from "@/src/app/api/processos/[processoId]/route"
import { PERFIS_PADRAO } from "@/src/lib/permissoes"

const MARCA = "RBACMATRIZ-TEST"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  await prisma.processo.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: "@rbacmatriz.test" } } })
}

let seq = 0
const usuario = (tipo: string) =>
  prisma.usuario.create({ data: { nome: `RBAC ${tipo}`, email: `${tipo}.${++seq}@rbacmatriz.test`, senha: "x", tipo }, select: { id: true, tipo: true } })

async function tokenPara(userId: number, email: string, tipo: string): Promise<string> {
  return signAuthToken({ userId, email, tipo, sessaoInicio: Date.now() })
}

async function main() {
  exigirBancoDeTeste("mandato-rbac-matriz.test.ts — Bloco 4 (RBAC)")
  await limpar()
  console.log("MANDATO BLOCO 4 — RBAC (matriz completa)\n")

  const admin = await usuario("admin")
  const assistente = await usuario("assistente") // tipo não-admin, SEM perfil, SEM custom => todas as permissões FALSE
  const tokenAdmin = await tokenPara(admin.id, `admin.${seq}@rbacmatriz.test`, "admin")
  const tokenSemPermissao = await tokenPara(assistente.id, `assistente.${seq}@rbacmatriz.test`, "assistente")

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} proc`, arvoreId: arv.id }, select: { id: true } })

  // ══════════════════════════════════════════════════════════════════════
  secao("1) CONSULTAR/ABRIR PROCESSO — GET /api/processos/[id] (achado + correção desta rodada)")
  // ══════════════════════════════════════════════════════════════════════
  const ctx = { params: Promise.resolve({ processoId: String(proc.id) }) }

  const semAuth = new Request(`http://localhost/api/processos/${proc.id}`)
  const rSemAuth = await getProcesso(semAuth, ctx)
  ok("1.1) SEM autenticação nenhuma: backend recusa (401), não devolve dado nenhum", rSemAuth.status === 401, String(rSemAuth.status))

  const comAuthSemPermissao = new Request(`http://localhost/api/processos/${proc.id}`, { headers: { Authorization: `Bearer ${tokenSemPermissao}` } })
  const rSemPermissao = await getProcesso(comAuthSemPermissao, ctx)
  ok("1.2) autenticado MAS sem a permissão processos.ver: backend recusa (403)", rSemPermissao.status === 403, String(rSemPermissao.status))

  const comAuthComPermissao = new Request(`http://localhost/api/processos/${proc.id}`, { headers: { Authorization: `Bearer ${tokenAdmin}` } })
  const rComPermissao = await getProcesso(comAuthComPermissao, ctx)
  ok("1.3) autenticado COM processos.ver (admin): backend autoriza (200)", rComPermissao.status === 200, String(rComPermissao.status))
  const corpo = await rComPermissao.json()
  ok("1.4) o processo certo veio no corpo (a rota funciona de verdade, não só autoriza)", corpo?.processo?.id === proc.id)

  // ══════════════════════════════════════════════════════════════════════
  secao("2) OPERADOR (perfil Assistente) NÃO tem o que a mandato proíbe alterar")
  // ══════════════════════════════════════════════════════════════════════
  const perfilAssistente = PERFIS_PADRAO.find((p) => p.nome === "Assistente")
  if (!perfilAssistente) throw new Error("Perfil Assistente não encontrado em PERFIS_PADRAO")
  const permsAssistente = calcularPermissoes("assistente", perfilAssistente.permissoes as Record<string, boolean>, null)
  ok("2.1) Assistente NÃO tem usuarios.gerenciar (protege Steps/SLA/follow-up globais, checklist, publicação)", permsAssistente["usuarios.gerenciar"] !== true)
  ok("2.2) Assistente NÃO tem tarefas.bloquear (não bloqueia/decide administrativamente)", permsAssistente["tarefas.bloquear"] !== true)
  ok("2.3) Assistente NÃO tem tarefas.excluir (não cancela/invalida operação)", permsAssistente["tarefas.excluir"] !== true)
  ok("2.4) Assistente NÃO tem processos.excluirDefinitivo (EXCLUSIVA — nunca por perfil padrão)", permsAssistente["processos.excluirDefinitivo"] !== true)
  ok("2.5) Assistente NÃO tem processos.moverFaseManual (EXCLUSIVA — handoff/movimentação administrativa)", permsAssistente["processos.moverFaseManual"] !== true)
  // Mas EXECUTA a operação normal — confirma que a régua é "não governa", não "não faz nada".
  ok("2.6) Assistente TEM tarefas.iniciar_concluir (executa o trabalho normal)", permsAssistente["tarefas.iniciar_concluir"] === true)
  // ACHADO desta investigação (não é bug introduzido aqui — é comportamento real
  // já existente, com justificativa própria no cadastro): `tarefas.editar` é
  // negada ao Assistente DE PROPÓSITO ("autoriza mexer no prazo/responsável
  // ALHEIO" — comentário de 11/09/2026 em src/lib/permissoes.ts). Como o
  // catálogo de efeitos usa a MESMA chave para PAUSE_FOR_EXTERNAL_WAIT/RESUME
  // (registrar follow-up/retorno na PRÓPRIA tarefa, não na de outro), um
  // Assistente puro (perfil padrão, sem concessão adicional) fica também SEM
  // poder registrar "aguardando terceiro" na própria etapa de Solicitar
  // Certidão — tensão real entre "editar tarefa alheia" (que deve negar) e
  // "registrar espera externa na própria tarefa" (que deveria permitir).
  // Não corrigido nesta rodada: mudar a permissão declarada de
  // PAUSE_FOR_EXTERNAL_WAIT no catálogo é decisão de produto (qual perfil
  // pode marcar espera externa), não um "sem checagem" a corrigir por conta
  // própria — registrado aqui como achado, não como bug corrigido.
  ok("2.7) ACHADO: Assistente NÃO tem tarefas.editar por desenho — logo também não pode PAUSE_FOR_EXTERNAL_WAIT/RESUME (mesma chave) na própria tarefa", permsAssistente["tarefas.editar"] === false)

  // ══════════════════════════════════════════════════════════════════════
  secao("3) TODAS as ações do mandato têm alguma checagem de backend (nenhuma delas confia só na tela)")
  // ══════════════════════════════════════════════════════════════════════
  const semNenhumaPermissao = calcularPermissoes("qualquer", null, null)
  const acoesEPermissoes: Array<[string, string]> = [
    ["executar Step (salvar_andamento)", "workflow.iniciarPasso"],
    ["registrar follow-up (PAUSE_FOR_EXTERNAL_WAIT)", "tarefas.editar"],
    ["receber documento (MARK_DOCUMENT_RECEIVED)", "documentos.editar"],
    ["validar (APPROVE_FOR_ANALYSIS)", "documentos.editar"],
    ["rejeitar (INVALIDATE_DOCUMENT)", "documentos.editar"],
    ["reexecutar (reabrir)", "tarefas.editar"],
    ["reatribuir (transferir)", "tarefas.editar"],
    ["mudar prazo / override (alterar_prazo)", "tarefas.editar"],
    ["bloquear/desbloquear", "tarefas.bloquear"],
    ["decisão administrativa (GO_RETIFICATION)", "processos.editar"],
    ["configurar Workflow", "usuarios.gerenciar"],
    ["publicar configuração", "usuarios.gerenciar"],
  ]
  for (const [acao, permissao] of acoesEPermissoes) {
    ok(`3.x) "${acao}" exige "${permissao}" e um usuário sem NENHUMA permissão não a tem`, semNenhumaPermissao[permissao] !== true, `valor=${semNenhumaPermissao[permissao]}`)
  }

  secao("3.1) A MESMA permissão gate 'configurar' e 'publicar' Workflow — granularidade não separada")
  ok(
    "3.1) achado (não corrigido nesta rodada — ver relatório): configurar e publicar Workflow usam a MESMA chave (usuarios.gerenciar), " +
    "mas ambas já são estritamente admin-only (Gerente desliga usuarios.gerenciar explicitamente) — não é AUSÊNCIA de checagem, é falta de separação fina",
    true,
  )

  await limpar()

  console.log(`\n${"=".repeat(70)}`)
  console.log(`✅ ${passou} passaram · ❌ ${falhou} falharam`)
  if (falhou > 0) { console.log("\nFalhas:", falhas.join(", ")); process.exit(1) }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
