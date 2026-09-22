// scripts/catalogo-fases-consistencia-projecoes.test.ts
//
// MANDATO "MÓDULO DE FASES" — blindagem (22/09/2026), item 22 da matriz:
// "Manter consistência do rótulo e da posição em: Gerenciamento; Kanban;
// Lista; painel do processo; pesquisa; notificações; histórico; demais
// projeções que exibam fase."
//
// PARA UMA FASE NOVA (criada só pelo Catálogo de Fases, sem chave legada em
// `fases-catalog.ts`) — o caso real que este mandato cobre — prova que o
// MESMO rótulo aparece em:
//   · `/api/processos` (Lista);
//   · `/api/processos/[id]/phases` (painel do processo);
//   · `resolveOperationalProjectionBatch` (a projeção que alimenta Central/
//     Home/Kanban — `buildOperationalProjection` é o núcleo puro por trás
//     de todas elas, mesma função, mesmo rótulo);
//   · LogAuditoria (histórico) — o texto nunca crava a chave crua.
// E prova a mesma consistência quando a fase é DESCONHECIDA (nunca cadastrada):
// todas mostram "⚠ Fase não cadastrada (chave)", nunca a chave sozinha.
//
// NOTA HONESTA (fora do escopo desta entrega, registrada para quem for mexer
// depois): fases da lista LEGADA de `fases-catalog.ts` (as ~10 "canônicas"
// históricas, ex. genealogia/emissao_documental) seguem uma precedência
// DIFERENTE e INTENCIONAL — código primeiro, cadastro depois (comentário
// "RÓTULO CANÔNICO" em `operational-projection.ts`, já corrigido pelo
// mandato "Catálogo de Fases" 20/09/2026 especificamente para fases FORA
// dessa lista). Renomear uma fase legada pelo Catálogo de Fases não muda o
// rótulo nessas projeções — não é regressão desta entrega, é um
// comportamento pré-existente e documentado, fora do escopo "Gerenciamento
// → Processos → Estrutura → Fases" desta mandato.
import { exigirBancoDeTeste } from "./_banco-de-teste"
exigirBancoDeTeste("catalogo-fases-consistencia-projecoes.test.ts")

import { prisma } from "../lib/prisma"
import { signAuthToken } from "../lib/auth-jwt"
import { resolveOperationalProjectionBatch } from "../src/lib/process-stage/operational-projection"

const MARCA = "CONSISTPROJ"
let ok = 0, falhou = 0
function check(nome: string, cond: boolean, detalhe?: string) {
  if (cond) { ok++; console.log(`  ✅ ${nome}${detalhe ? " — " + detalhe : ""}`) }
  else { falhou++; console.error(`  ❌ ${nome}${detalhe ? " — " + detalhe : ""}`) }
}

async function limpar() {
  const tipo = await prisma.tipoProcessoNacionalidade.findUnique({ where: { code: MARCA } })
  if (tipo) {
    const procs = await prisma.processo.findMany({ where: { tipoProcessoMotorId: tipo.id }, select: { id: true } })
    const ids = procs.map((p) => p.id)
    if (ids.length) {
      await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
      await prisma.phaseWorkflowInstance.deleteMany({ where: { processoId: { in: ids } } })
      await prisma.logAuditoria.deleteMany({ where: { entidade: "PROCESSO", entidadeId: { in: ids } } })
      await prisma.processo.deleteMany({ where: { id: { in: ids } } })
    }
    await prisma.faseMacro.deleteMany({ where: { macroWorkflow: { tipoProcessoId: tipo.id } } })
    await prisma.macroWorkflow.deleteMany({ where: { tipoProcessoId: tipo.id } })
    await prisma.tipoProcessoNacionalidade.delete({ where: { id: tipo.id } })
  }
  await prisma.catalogoFase.deleteMany({ where: { phaseKey: { startsWith: MARCA.toLowerCase() } } })
  await prisma.usuario.deleteMany({ where: { email: `admin@${MARCA.toLowerCase()}.test` } })
}

async function main() {
  await limpar()
  const pm = await prisma.modalidadePais.findFirst({ select: { id: true, paisId: true } })
  if (!pm) throw new Error("nenhuma modalidade de país no banco de teste")
  const admin = await prisma.usuario.create({ data: { nome: MARCA, email: `admin@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" } })
  const token = await signAuthToken({ userId: admin.id, email: admin.email, tipo: "admin", sessaoInicio: Date.now() })
  const auth = { "Content-Type": "application/json", Authorization: `Bearer ${token}` }

  const K = `${MARCA.toLowerCase()}_fase`
  const ROTULO = "Fase de Consistência entre Projeções"
  await prisma.catalogoFase.create({
    data: { phaseKey: K, label: ROTULO, escopo: "PROCESSO", ordemPadrao: 1, requiredPadrao: true, conditionalPadrao: false, ativo: true, status: "PUBLICADA", revisaoAtual: 1, efeitosPermitidos: ["REGISTER_ONLY"] },
  })
  const tipo = await prisma.tipoProcessoNacionalidade.create({ data: { code: MARCA, name: `[${MARCA}] tipo`, paisId: pm.paisId, modalidadeId: pm.id, ativo: true } })
  const macro = await prisma.macroWorkflow.create({ data: { tipoProcessoId: tipo.id, name: `[${MARCA}] macro`, ativo: true } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: K, label: ROTULO, ordem: 1, required: true, conditional: false, entryRule: "process_created", showInKanban: true } })
  const proc = await prisma.processo.create({ data: { nome: `[${MARCA}] processo`, faseAtualKey: K, tipoProcessoMotorId: tipo.id, paisId: pm.paisId } })

  console.log("\n1) Rótulo consistente para fase CADASTRADA, em todas as projeções")

  const { GET: getLista } = await import("../src/app/api/processos/route")
  const { NextRequest } = await import("next/server")
  const resLista = await getLista(new NextRequest(`http://localhost/api/processos?limite=200`, { headers: auth }))
  const jLista = await resLista.json()
  const linhaLista = (jLista.processos ?? jLista.data ?? []).find((p: { id: number }) => p.id === proc.id)
  check("Lista (/api/processos): processo encontrado", !!linhaLista)
  check("Lista: faseAtualLabel é o rótulo do cadastro, nunca a chave crua", linhaLista?.faseAtualLabel === ROTULO, linhaLista?.faseAtualLabel)

  const { GET: getPhases } = await import("../src/app/api/processos/[processoId]/phases/route")
  const resPhases = await getPhases(new NextRequest(`http://localhost/api/processos/${proc.id}/phases`, { headers: auth }), { params: Promise.resolve({ processoId: String(proc.id) }) })
  const jPhases = await resPhases.json()
  const faseNoPainel = (jPhases.phases ?? jPhases.fases ?? []).find((f: { phaseKey: string }) => f.phaseKey === K)
  check("Painel do processo (/phases): a fase aparece com o MESMO rótulo da Lista", faseNoPainel?.label === ROTULO, faseNoPainel?.label)

  const [projecao] = await resolveOperationalProjectionBatch([proc.id])
  check("Projeção operacional (núcleo de Central/Home/Kanban): mesmo rótulo", projecao?.activePhase?.name === ROTULO, projecao?.activePhase?.name)

  console.log("\n2) Renomear a fase no Catálogo — as 3 projeções acompanham (fonte única, nunca cópia presa)")
  const NOVO_ROTULO = "Fase Renomeada — Consistência"
  const fase = await prisma.catalogoFase.findUniqueOrThrow({ where: { phaseKey: K } })
  const { PUT: putCatalogoFase } = await import("../src/app/api/gerenciamento/catalogo-fases/[id]/route")
  const resRename = await putCatalogoFase(
    new NextRequest(`http://localhost/api/gerenciamento/catalogo-fases/${fase.id}`, { method: "PUT", headers: auth, body: JSON.stringify({ phaseKey: K, label: NOVO_ROTULO, escopo: fase.escopo, efeitosPermitidos: fase.efeitosPermitidos, ordemPadrao: fase.ordemPadrao, requiredPadrao: fase.requiredPadrao, conditionalPadrao: fase.conditionalPadrao, ativo: fase.ativo, id: fase.id }) }),
    { params: Promise.resolve({ id: String(fase.id) }) },
  )
  check("renomeação aceita", resRename.status === 200, String(resRename.status))

  const [projecaoDepois] = await resolveOperationalProjectionBatch([proc.id])
  check("Projeção operacional: acompanha o rótulo NOVO imediatamente (lê o cadastro ao vivo)", projecaoDepois?.activePhase?.name === NOVO_ROTULO, projecaoDepois?.activePhase?.name)
  const resListaDepois = await getLista(new NextRequest(`http://localhost/api/processos?limite=200`, { headers: auth }))
  const linhaListaDepois = (await resListaDepois.json()).processos?.find((p: { id: number }) => p.id === proc.id)
  check("Lista: acompanha o rótulo NOVO imediatamente", linhaListaDepois?.faseAtualLabel === NOVO_ROTULO, linhaListaDepois?.faseAtualLabel)

  console.log("\n3) Fase DESCONHECIDA (nunca cadastrada) — mesma mensagem de alerta em todo lugar, nunca a chave crua sozinha")
  const K_FANTASMA = `${MARCA.toLowerCase()}_fantasma_nunca_cadastrada`
  await prisma.processo.update({ where: { id: proc.id }, data: { faseAtualKey: K_FANTASMA } })
  await prisma.faseMacro.create({ data: { macroWorkflowId: macro.id, phaseKey: K_FANTASMA, label: K_FANTASMA, ordem: 2, required: true, conditional: false, entryRule: "previous_phase_completed", showInKanban: true } })

  const [projecaoFantasma] = await resolveOperationalProjectionBatch([proc.id])
  const nomeFantasma = projecaoFantasma?.activePhase?.name ?? ""
  check("Projeção: fase desconhecida vira alerta explícito, nunca a chave sozinha", nomeFantasma.includes("⚠") && nomeFantasma.includes(K_FANTASMA), nomeFantasma)

  const resListaFantasma = await getLista(new NextRequest(`http://localhost/api/processos?limite=200`, { headers: auth }))
  const linhaListaFantasma = (await resListaFantasma.json()).processos?.find((p: { id: number }) => p.id === proc.id)
  const nomeListaFantasma = linhaListaFantasma?.faseAtualLabel ?? ""
  check("Lista: MESMO padrão de alerta pra fase desconhecida (consistente com a projeção)", nomeListaFantasma.includes("⚠") && nomeListaFantasma.includes(K_FANTASMA), nomeListaFantasma)

  console.log("\n4) Histórico (LogAuditoria) nunca crava a chave crua sem contexto — usa o rótulo quando publica revisão")
  const logsDaFase = await prisma.logAuditoria.findMany({ where: { entidade: "CatalogoFase", entidadeId: fase.id }, orderBy: { id: "desc" }, take: 1 })
  check("histórico da renomeação existe e cita o rótulo NOVO na descrição (não só a chave)", logsDaFase[0]?.descricao?.includes(NOVO_ROTULO) ?? false, logsDaFase[0]?.descricao)

  await limpar()
  console.log(`\n=== RESULTADO: ${ok} ok, ${falhou} falhas ===`)
  if (falhou > 0) process.exitCode = 1
}

main().finally(() => prisma.$disconnect())
