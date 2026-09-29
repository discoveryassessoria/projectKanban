// scripts/sino-ownership.test.ts
// ============================================================================
// O SINO RESPEITA OWNERSHIP — correção pontual 17/09/2026, reescrita para o sino
// AGRUPADO (redesenho 29/09/2026).
// Rodar: PRISMA_DATABASE_URL=...discovery_test npx tsx scripts/sino-ownership.test.ts
//
// ACHADO: `GET /api/notificacoes` filtrava `{ OR: [{responsavelId: eu},
// {responsavelId: null}] }` para Admin — toda tarefa NORMAL sem responsável
// do sistema inteiro (ex.: 15 certidões da Grisotto ainda não distribuídas)
// virava "PRÓXIMOS 3 DIAS (15)" no sino PESSOAL do Admin, mesmo sem nenhuma
// delas ter sido atribuída a ele. Visibilidade administrativa (Tarefas e
// Projetos/Central Operacional/obrigação ATRIBUIR_TAREFAS) != notificação
// pessoal (o que a PESSOA tem para fazer) — as duas são perguntas diferentes.
//
// Contrato novo, o que este arquivo prova:
//   • o aviso pessoal (CHEGOU_TRABALHO / PRECISA_AGIR) só lista tarefa do RESPONSÁVEL;
//     tarefa sem dono NUNCA vira aviso pessoal do Admin;
//   • o Admin recebe UM aviso de gestor por família (SEM_RESPONSAVEL, "N tarefas sem
//     responsável há mais de 1 dia") com link para /operacao/distribuicao — a antiga
//     DISTRIBUICAO_NECESSARIA foi fundida nele;
//   • atribuir tira as tarefas do aviso do gestor na hora e o aviso some;
//   • a Daniela recebe UM CHEGOU_TRABALHO ("15 tarefas atribuídas a você"), nunca 15.
//
// ESCREVE NO BANCO — só roda no banco de teste local.
// ============================================================================
import { prisma } from "@/lib/prisma"
import { exigirBancoDeTeste } from "./_banco-de-teste"
import { signAuthToken } from "@/lib/auth-jwt"
import { criarTarefaManual } from "@/lib/operacional/tarefa-ciclo"
import { redistribuirTarefas } from "@/lib/operacional/tarefa-comandos"
import { reconciliarObrigacaoDeAtribuicao, usuarioResponsavelPelaDistribuicao } from "@/lib/operacional/obrigacao-atribuicao"
import { marcarNotificacaoComoLida } from "@/lib/operacional/notificacao-canonica"
import { avisarGestores, rodarResumoDiario } from "@/lib/operacional/avisos-sino"
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

async function sinoDe(userId: number, email: string, tipo: string) {
  const token = await tokenPara(userId, email, tipo)
  const req = new Request("http://localhost/api/notificacoes", { headers: { Authorization: `Bearer ${token}` } })
  const resp = await getNotificacoes(req as never)
  if (resp.status !== 200) throw new Error(`sino respondeu ${resp.status} para userId=${userId}`)
  return resp.json() as Promise<{
    avisos: Array<{ id: number; tipo: string; titulo: string; link: string; familiaId: number | null; contagem: number }>
    anteriores: Array<{ id: number }>; total: number
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
  // "Sem responsável há mais de 1 dia": recua a criação das 15 (como sino-agrupado.test.ts).
  await prisma.tarefa.updateMany({ where: { id: { in: tarefaIds } }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } })
  await avisarGestores({ agora: new Date() })
  const sinoAdminAntes = await sinoDe(admin.id, admin.email, admin.tipo)
  const pessoaisDoAdmin = await prisma.notificacaoOperacional.findMany({
    where: { destinatarioId: admin.id, agrupado: true, tipo: { in: ["CHEGOU_TRABALHO", "PRECISA_AGIR"] }, tarefaIds: { hasSome: tarefaIds } },
    select: { id: true },
  })
  ok(
    "3) NENHUMA das 15 certidões sem responsável aparece como aviso PESSOAL (CHEGOU_TRABALHO/PRECISA_AGIR) do Admin",
    pessoaisDoAdmin.length === 0,
    `vazadas: ${pessoaisDoAdmin.length}`,
  )
  // Escopado à FAMÍLIA desta obrigação — nunca uma contagem global: o banco de teste é
  // compartilhado entre suítes, e o mesmo Admin pode ter avisos de OUTRA família/suíte.
  const distribuicaoDesteProcesso = sinoAdminAntes.avisos.filter((a) => a.tipo === "SEM_RESPONSAVEL" && a.familiaId === proc.id)
  ok("4) exatamente 1 aviso de gestor SEM_RESPONSAVEL DESTA família no sino do Admin (não 15)", distribuicaoDesteProcesso.length === 1, String(distribuicaoDesteProcesso.length))
  ok("4) o aviso diz '<Família> — 15 tarefas sem responsável há mais de 1 dia'",
    distribuicaoDesteProcesso[0]?.titulo === `${MARCA} Grisotto — 15 tarefas sem responsável há mais de 1 dia` && distribuicaoDesteProcesso[0].contagem === 15, distribuicaoDesteProcesso[0]?.titulo)
  ok("4) o aviso leva direto para o contexto de execução da distribuição da família",
    distribuicaoDesteProcesso[0]?.link === `/operacao/distribuicao?processo=${proc.id}`, distribuicaoDesteProcesso[0]?.link ?? "")
  ok("4) a antiga DISTRIBUICAO_NECESSARIA não nasce mais (fundida em SEM_RESPONSAVEL)",
    (await prisma.notificacaoOperacional.count({ where: { processoId: proc.id, tipo: "DISTRIBUICAO_NECESSARIA" } })) === 0)
  ok("4) nem um aviso por tarefa (tarefaId preenchido) para o Admin",
    (await prisma.notificacaoOperacional.count({ where: { destinatarioId: admin.id, tarefaId: { in: tarefaIds } } })) === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("5) Admin atribui as 15 para Daniela")
  // ══════════════════════════════════════════════════════════════════════
  const resDistrib = await redistribuirTarefas({ tarefaIds, novoResponsavelId: daniela.id, autorId: admin.id, motivo: "teste — distribuir para Daniela" })
  ok("5) as 15 foram atribuídas", resDistrib.sucesso === 15, `${resDistrib.sucesso}/${resDistrib.total}`)

  // ══════════════════════════════════════════════════════════════════════
  secao("6) SINO do Admin DEPOIS — a obrigação se resolveu")
  // ══════════════════════════════════════════════════════════════════════
  const sinoAdminDepois = await sinoDe(admin.id, admin.email, admin.tipo)
  const aindaPendenteDesteProcesso = sinoAdminDepois.avisos.filter((a) => a.tipo === "SEM_RESPONSAVEL" && a.familiaId === proc.id)
  ok("6) o aviso de distribuição DESTA família não fica mais pendente no sino do Admin", aindaPendenteDesteProcesso.length === 0, String(aindaPendenteDesteProcesso.length))
  const obrigacaoDepois = await prisma.tarefa.findUnique({ where: { id: obrigacao!.id }, select: { concluida: true } })
  ok("6) a obrigação administrativa foi concluída", obrigacaoDepois?.concluida === true)
  // Ela mesma reconcilia sem novo aviso: rodar o gestor de novo não ressuscita nada.
  await avisarGestores({ agora: new Date() })
  ok("6) e rodar a lista do gestor de novo não ressuscita o aviso",
    (await prisma.notificacaoOperacional.count({ where: { destinatarioId: admin.id, processoId: proc.id, tipo: "SEM_RESPONSAVEL" } })) === 0)

  // ══════════════════════════════════════════════════════════════════════
  secao("7/8) SINO da Daniela — UM aviso de chegada; o prazo vem pelo resumo do dia, agrupado")
  // ══════════════════════════════════════════════════════════════════════
  const sinoDanielaAntesDeLer = await sinoDe(daniela.id, daniela.email, daniela.tipo)
  ok(
    "7) enquanto o aviso de chegada está pendente, as 15 NÃO explodem em avisos individuais (correção 17/09/2026)",
    sinoDanielaAntesDeLer.avisos.length === 1 && sinoDanielaAntesDeLer.total === 1, `${sinoDanielaAntesDeLer.avisos.length} aviso(s)`,
  )
  const consolidada = sinoDanielaAntesDeLer.avisos.find((a) => a.tipo === "CHEGOU_TRABALHO" && a.familiaId === proc.id)
  ok("7) existe o aviso consolidado da atribuição: '15 tarefas atribuídas a você'",
    consolidada?.contagem === 15 && consolidada.titulo === `${MARCA} Grisotto — 15 tarefas atribuídas a você`, consolidada?.titulo)

  // Marcar como lido não muda nada nas tarefas — aviso lido ≠ tarefa concluída.
  if (consolidada) await marcarNotificacaoComoLida(prisma, { notificacaoId: consolidada.id, usuarioId: daniela.id })
  // O prazo (em 2 dias) chega na véspera: o resumo das 07:00 diz que 15 vencem amanhã — em UM aviso.
  await rodarResumoDiario({ agora: new Date(Date.now() + 86_400_000) })
  const sinoDaniela = await sinoDe(daniela.id, daniela.email, daniela.tipo)
  const agir = sinoDaniela.avisos.filter((a) => a.tipo === "PRECISA_AGIR" && a.familiaId === proc.id)
  ok("7) depois de lida a chegada, as 15 voltam pelo prazo normal — num único PRECISA_AGIR '15 vencem amanhã'",
    agir.length === 1 && agir[0].titulo === `${MARCA} Grisotto — 15 vencem amanhã` && agir[0].contagem === 15, agir[0]?.titulo ?? "sem aviso")
  const linhaAgir = await prisma.notificacaoOperacional.findUnique({ where: { id: agir[0]?.id ?? 0 }, select: { tarefaIds: true } })
  ok("8) nenhuma duplicação — 15 ids distintos, nunca mais", new Set(linhaAgir?.tarefaIds).size === 15 && tarefaIds.every((id) => linhaAgir?.tarefaIds.includes(id)))
  const sinoAdminFinal = await sinoDe(admin.id, admin.email, admin.tipo)
  ok("8) o sino do Admin não mostra as 15 (ownership migrou de verdade)",
    (await prisma.notificacaoOperacional.count({
      where: { destinatarioId: admin.id, agrupado: true, lidaEm: null, tarefaIds: { hasSome: tarefaIds } },
    })) === 0 && sinoAdminFinal.avisos.every((a) => a.familiaId !== proc.id))

  console.log(`\n${passou} passaram, ${falhou} falharam`)
  if (falhou > 0) { console.log("Falhas:", falhas.join(", ")); process.exitCode = 1 }
  await limpar()
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
