// scripts/sino-ownership.test.ts
// ============================================================================
// O SINO RESPEITA OWNERSHIP — correção pontual 17/09/2026.
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/sino-ownership.test.ts
//
// ACHADO: `GET /api/notificacoes` filtrava `{ OR: [{responsavelId: eu},
// {responsavelId: null}] }` para Admin — toda tarefa NORMAL sem responsável
// do sistema inteiro (ex.: 15 certidões da Grisotto ainda não distribuídas)
// virava "PRÓXIMOS 3 DIAS (15)" no sino PESSOAL do Admin, mesmo sem nenhuma
// delas ter sido atribuída a ele. Visibilidade administrativa (Tarefas e
// Projetos/Central Operacional/obrigação ATRIBUIR_TAREFAS) != notificação
// pessoal de prazo (vencida/hoje/próximos 3 dias) — as duas são perguntas
// diferentes, e só a segunda é o que este arquivo prova.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { signAuthToken } from "@/lib/auth-jwt"
import { criarTarefaManual } from "@/lib/operacional/tarefa-ciclo"
import { redistribuirTarefas } from "@/lib/operacional/tarefa-comandos"
import { reconciliarObrigacaoDeAtribuicao, usuarioResponsavelPelaDistribuicao } from "@/lib/operacional/obrigacao-atribuicao"
import { GET as getNotificacoes } from "@/src/app/api/notificacoes/route"

const MARCA = "SINOOWN"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (nome: string, cond: boolean, extra = "") => {
  if (cond) { passou++; console.log(`  ✅ ${nome}${extra ? ` — ${extra}` : ""}`) }
  else { falhou++; falhas.push(nome); console.log(`  ❌ ${nome}${extra ? ` — ${extra}` : ""}`) }
}
const secao = (t: string) => console.log(`\n${t}`)

async function limpar() {
  const procs = await prisma.processo.findMany({ where: { nome: { startsWith: MARCA } }, select: { id: true, arvoreId: true } })
  const ids = procs.map((p) => p.id)
  const ts = await prisma.tarefa.findMany({ where: { processoId: { in: ids } }, select: { id: true } })
  await prisma.notificacaoOperacional.deleteMany({ where: { OR: [{ tarefaId: { in: ts.map((t) => t.id) } }, { processoId: { in: ids } }] } })
  await prisma.logAuditoria.deleteMany({ where: { entidade: "Tarefa", entidadeId: { in: ts.map((t) => t.id) } } })
  await prisma.tarefa.deleteMany({ where: { processoId: { in: ids } } })
  await prisma.processo.deleteMany({ where: { id: { in: ids } } })
  await prisma.arvore.deleteMany({ where: { nome: { startsWith: MARCA } } })
  await prisma.usuario.deleteMany({ where: { email: { endsWith: `@${MARCA.toLowerCase()}.test` } } })
}

async function tokenPara(userId: number, email: string, tipo: string): Promise<string> {
  return signAuthToken({ userId, email, tipo, sessaoInicio: Date.now() })
}

async function bucketsDoSino(userId: number, email: string, tipo: string) {
  const token = await tokenPara(userId, email, tipo)
  const req = new Request("http://localhost/api/notificacoes", { headers: { Authorization: `Bearer ${token}` } })
  const resp = await getNotificacoes(req as never)
  if (resp.status !== 200) throw new Error(`sino respondeu ${resp.status} para userId=${userId}`)
  return resp.json() as Promise<{
    vencidas: Array<{ id: number }>; hoje: Array<{ id: number }>; proximos3Dias: Array<{ id: number }>
    acontecimentos: Array<{ id: number; tipo: string; link: string }>
  }>
}

async function main() {
  exigirBancoDeTeste("prova que o sino respeita ownership (correção 17/09/2026)")
  await limpar()
  console.log("O SINO RESPEITA OWNERSHIP (cenário Grisotto)\n")

  // 2) Marco é Admin.
  const marco = await prisma.usuario.create({
    data: { nome: `${MARCA} Marco`, email: `marco@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "admin" },
    select: { id: true, email: true, tipo: true },
  })
  const daniela = await prisma.usuario.create({
    data: { nome: `${MARCA} Daniela`, email: `daniela@${MARCA.toLowerCase()}.test`, senha: "x", tipo: "assistente" },
    select: { id: true, email: true, tipo: true },
  })

  const arv = await prisma.arvore.create({ data: { nome: `${MARCA} arv` }, select: { id: true } })
  const proc = await prisma.processo.create({ data: { nome: `${MARCA} Grisotto`, arvoreId: arv.id }, select: { id: true } })

  const emDoisDias = new Date()
  emDoisDias.setDate(emDoisDias.getDate() + 2)

  // 1) 15 tarefas NORMAIS sem responsável, com prazo próximo — pela porta
  // canônica (`criarTarefaManual`), nunca `prisma.tarefa.create` direto.
  const tarefaIds: number[] = []
  for (let i = 0; i < 15; i++) {
    const r = await criarTarefaManual({
      processoId: proc.id,
      titulo: `${MARCA} certidão ${i}`,
      autorId: marco.id,
      responsavelId: null,
      dataPrazo: emDoisDias,
      motivo: "cenário de teste do sino — ownership",
      confirmarDuplicidade: true,
    })
    if (!r.ok) throw new Error(`falha ao criar tarefa de teste #${i}: ${r.mensagem}`)
    tarefaIds.push(r.tarefaId)
  }
  await reconciliarObrigacaoDeAtribuicao(prisma, proc.id)

  // QUEM a competência resolveu — nunca assumido por posição/id fixo (achado
  // real desta mesma rodada: banco de teste compartilhado pode ter admin
  // remanescente de outra suíte com id menor).
  const responsavelDistribuicaoId = await usuarioResponsavelPelaDistribuicao(prisma)
  ok("competência resolvida para algum usuário", responsavelDistribuicaoId != null)
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { id: responsavelDistribuicaoId! }, select: { id: true, email: true, tipo: true } })
  ok("o resolvido é Admin", admin.tipo === "admin", admin.email)

  const obrigacao = await prisma.tarefa.findFirst({
    where: { processoId: proc.id, tipo: "ADMINISTRATIVA", origem: "obrigacao-atribuicao", concluida: false },
    select: { id: true, responsavelId: true },
  })
  ok("a obrigação administrativa nasceu", obrigacao != null)
  ok("a obrigação já pertence ao Admin resolvido (sem circularidade)", obrigacao?.responsavelId === admin.id)

  // ══════════════════════════════════════════════════════════════════════
  secao("3/4) SINO do Admin ANTES da atribuição")
  // ══════════════════════════════════════════════════════════════════════
  const sinoAdminAntes = await bucketsDoSino(admin.id, admin.email, admin.tipo)
  const idsNoSino = [...sinoAdminAntes.vencidas, ...sinoAdminAntes.hoje, ...sinoAdminAntes.proximos3Dias].map((x) => x.id)
  const vazamento = tarefaIds.filter((id) => idsNoSino.includes(id))
  ok(
    "3) NENHUMA das 15 certidões sem responsável aparece como notificação pessoal de prazo do Admin",
    vazamento.length === 0,
    `vazadas: ${vazamento.length}`,
  )
  // Escopado ao LINK desta obrigação (contém `processoId=<proc.id>`) — nunca
  // uma contagem global: o banco de teste é compartilhado entre suítes, e o
  // mesmo Admin pode ter notificações de OUTRO processo/outra suíte ainda
  // não lidas. "Exatamente 1" precisa ser "exatamente 1 PARA ESTE processo".
  const distribuicaoNotifDesteProcesso = sinoAdminAntes.acontecimentos.filter(
    (a) => a.tipo === "DISTRIBUICAO_NECESSARIA" && a.link.includes(`processoId=${proc.id}`),
  )
  ok("4) exatamente 1 notificação da obrigação de distribuir DESTE processo no sino do Admin", distribuicaoNotifDesteProcesso.length === 1, String(distribuicaoNotifDesteProcesso.length))
  ok("4) a notificação leva direto para o contexto de execução da distribuição", (distribuicaoNotifDesteProcesso[0]?.link ?? "").includes("/operacao/central"))

  // ══════════════════════════════════════════════════════════════════════
  secao("5) Admin atribui as 15 para Daniela")
  // ══════════════════════════════════════════════════════════════════════
  const resDistrib = await redistribuirTarefas({ tarefaIds, novoResponsavelId: daniela.id, autorId: admin.id, motivo: "teste — distribuir para Daniela" })
  ok("5) as 15 foram atribuídas", resDistrib.sucesso === 15, `${resDistrib.sucesso}/${resDistrib.total}`)

  // ══════════════════════════════════════════════════════════════════════
  secao("6) SINO do Admin DEPOIS — a obrigação se resolveu")
  // ══════════════════════════════════════════════════════════════════════
  const sinoAdminDepois = await bucketsDoSino(admin.id, admin.email, admin.tipo)
  const aindaPendenteDesteProcesso = sinoAdminDepois.acontecimentos.filter(
    (a) => a.tipo === "DISTRIBUICAO_NECESSARIA" && a.link.includes(`processoId=${proc.id}`),
  )
  ok("6) a notificação de distribuição DESTE processo não fica mais pendente no sino do Admin", aindaPendenteDesteProcesso.length === 0, String(aindaPendenteDesteProcesso.length))
  const obrigacaoDepois = await prisma.tarefa.findUnique({ where: { id: obrigacao!.id }, select: { concluida: true } })
  ok("6) a obrigação administrativa foi concluída", obrigacaoDepois?.concluida === true)

  // ══════════════════════════════════════════════════════════════════════
  secao("7/8) SINO da Daniela — agora projeta as 15, sem duplicar")
  // ══════════════════════════════════════════════════════════════════════
  const sinoDaniela = await bucketsDoSino(daniela.id, daniela.email, daniela.tipo)
  const idsNoSinoDaniela = [...sinoDaniela.vencidas, ...sinoDaniela.hoje, ...sinoDaniela.proximos3Dias].map((x) => x.id)
  const achadasDaniela = tarefaIds.filter((id) => idsNoSinoDaniela.includes(id))
  ok("7) as 15 tarefas agora projetam notificação de prazo para Daniela", achadasDaniela.length === 15, String(achadasDaniela.length))
  ok("8) nenhuma duplicação — 15 ids distintos, nunca mais", new Set(idsNoSinoDaniela).size === idsNoSinoDaniela.length)
  ok("8) o sino do Admin não continua mostrando as 15 (ownership migrou de verdade)", tarefaIds.every((id) => !idsNoSinoAdminDepois(sinoAdminDepois, id)))

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(", ")); process.exitCode = 1 }
  await limpar()
}

function idsNoSinoAdminDepois(sino: { vencidas: Array<{ id: number }>; hoje: Array<{ id: number }>; proximos3Dias: Array<{ id: number }> }, id: number) {
  return [...sino.vencidas, ...sino.hoje, ...sino.proximos3Dias].some((x) => x.id === id)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
