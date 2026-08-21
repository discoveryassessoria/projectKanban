// scripts/reparo-residuos-producao.ts
// ============================================================================
// OS RESÍDUOS QUE A SAÚDE ACUSOU — reparados, um a um, com o motivo de cada um.
//
//   npx tsx scripts/reparo-residuos-producao.ts              SOMENTE LEITURA
//   npx tsx scripts/reparo-residuos-producao.ts --execute
//
// Cada reparo aqui é DETERMINÍSTICO: a resposta certa está no próprio dado, e não
// depende de ninguém decidir nada. O que exige decisão de negócio não entra —
// aparece no relatório final como o que é.
// ============================================================================
import { prisma } from '../lib/prisma'

const EXECUTAR = process.argv.includes('--execute')
const log = (s: string) => console.log(s)

async function main() {
  log(EXECUTAR ? 'REPARO DE RESÍDUOS — APLICANDO\n' : 'REPARO DE RESÍDUOS — SOMENTE LEITURA (use --execute)\n')

  // ── 1. EVENTOS DE WORKFLOW APONTANDO PARA PROCESSO INEXISTENTE ────────────
  //
  // Resíduo da limpeza autorizada de processos: o processo foi removido, o evento
  // ficou apontando para um id que não existe mais. NÃO é histórico — histórico é
  // aquilo que alguém consegue ler, e ninguém consegue abrir o processo #431 para
  // ver o que aconteceu nele. O que sobrou é uma linha que só faz a saúde apitar.
  //
  // `processoId` não tem FK (é ref solta, por desenho), então o banco não os levou
  // junto. A limpeza é a continuação da remoção que já foi decidida.
  log('EVENTOS DE WORKFLOW ÓRFÃOS')
  const orfaos = await prisma.$queryRawUnsafe<Array<{ id: number; tipo: string; processoId: number }>>(
    `SELECT we.id, we.tipo, we."processoId" FROM "WorkflowEvento" we
       LEFT JOIN "Processo" p ON p.id = we."processoId"
      WHERE we."processoId" IS NOT NULL AND p.id IS NULL
      ORDER BY we.id ASC`,
  )
  const porProcesso = new Map<number, number>()
  for (const o of orfaos) porProcesso.set(o.processoId, (porProcesso.get(o.processoId) ?? 0) + 1)
  for (const [pid, n] of [...porProcesso].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    log(`  ${EXECUTAR ? '✔' : '→'} processo #${pid} (não existe): ${n} evento(s)`)
  }
  if (porProcesso.size > 12) log(`  … e mais ${porProcesso.size - 12} processo(s) removido(s)`)
  if (EXECUTAR && orfaos.length > 0) {
    // Em lotes: uma exclusão de 457 ids num `IN` só é aceitável porque é pequena;
    // o lote mantém o padrão para o dia em que não for.
    const ids = orfaos.map((o) => o.id)
    for (let i = 0; i < ids.length; i += 500) {
      await prisma.workflowEvento.deleteMany({ where: { id: { in: ids.slice(i, i + 500) } } })
    }
  }
  log(`  total: ${orfaos.length} evento(s) de ${porProcesso.size} processo(s) removido(s)\n`)

  // ── 2. USUÁRIO SEM PERFIL ─────────────────────────────────────────────────
  //
  // NÃO é decisão de negócio: o usuário já declara o `tipo`, e existe um perfil com
  // exatamente esse nome. O perfil ausente não é uma escolha pendente — é um dado
  // que ficou para trás quando os perfis foram criados. Sem ele, `calcularPermissoes`
  // parte de um mapa vazio, e o usuário fica sem nada que não seja nominal.
  //
  // Onde o tipo NÃO corresponder a nenhum perfil, o script não escolhe: relata.
  log('USUÁRIO SEM PERFIL')
  const perfis = await prisma.perfil.findMany({ select: { id: true, nome: true } })
  const porNome = new Map(perfis.map((p) => [p.nome.toLowerCase(), p.id]))
  const DO_TIPO: Record<string, string> = {
    admin: 'administrador', assistente: 'assistente', gerente: 'gerente', estagiario: 'estagiário',
  }
  const semPerfil = await prisma.usuario.findMany({ where: { perfilId: null }, select: { id: true, nome: true, tipo: true } })
  let atribuidos = 0
  for (const u of semPerfil) {
    const alvo = porNome.get(DO_TIPO[u.tipo ?? ''] ?? '')
    if (!alvo) { log(`  ! ${u.nome} (tipo "${u.tipo}") — nenhum perfil com esse nome; decisão de quem administra`); continue }
    const nomePerfil = perfis.find((p) => p.id === alvo)!.nome
    log(`  ${EXECUTAR ? '✔' : '→'} ${u.nome}: tipo "${u.tipo}" → perfil "${nomePerfil}"`)
    if (EXECUTAR) { await prisma.usuario.update({ where: { id: u.id }, data: { perfilId: alvo } }); atribuidos++ }
  }
  log(`  total: ${semPerfil.length} sem perfil · atribuídos: ${atribuidos}\n`)

  // ── 3. FILA REPRESADA ─────────────────────────────────────────────────────
  //
  // Só relata: quem drena é o dispatcher, e agora existe um cron para isso. Contar
  // aqui é o "antes" contra o qual o "depois" será comparado.
  log('FILA (relatório — quem drena é /api/cron/outbox)')
  const fila = await prisma.domainOutbox.groupBy({
    by: ['tipo'], where: { status: 'PENDENTE' }, _count: { _all: true },
  })
  for (const f of fila.sort((a, b) => b._count._all - a._count._all)) {
    log(`  · ${f.tipo.padEnd(38)} ${f._count._all}`)
  }
  log(`  total pendente: ${fila.reduce((n, f) => n + f._count._all, 0)}`)

  if (!EXECUTAR) log('\nNada foi alterado. Para aplicar: --execute')
}

void main().finally(() => prisma.$disconnect())
