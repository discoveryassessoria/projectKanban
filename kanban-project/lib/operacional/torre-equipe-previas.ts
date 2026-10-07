// lib/operacional/torre-equipe-previas.ts
// ============================================================================
// EQUIPE — AS MUDANÇAS DE CARTEIRA SÃO PROPOSTA (consolidação da Torre, 06/10/2026). "Redistribuir", "Mover carteira" e "Aplicar saída" mostram a
// PRÉVIA (quem recebe o quê) e só gravam depois da confirmação (HTTP 428 → `confirmado` + assinatura, `src/lib/torre-confirmacao.ts`). O resultado
// aparece na aba Tarefas (o histórico de cada tarefa diz a origem). Estas funções só LEEM: o plano da prévia é o MESMO da execução.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { listarTarefasDaTorre } from '@/src/services/torre-tarefas'
import { sugerirSucessor } from './elegibilidade'
import { lerOrganizacao } from './organizacao'
import { quemAbsorve } from './torre-equipe-distribuicao'
import { sugestaoDeRedistribuicao } from './torre-equipe-distribuicao'
import type { PreviaDeConfirmacao } from '@/src/lib/torre-confirmacao'

const plural = (n: number, a: string, b: string) => (n === 1 ? a : b)

/** O que "Mover carteira" moveria de A para B (a mesma conta de `moverCarteira`). `null` = nada a mover / destino inválido. */
export async function previaDeMoverCarteira(args: { deUsuarioId: number; paraUsuarioId?: number | null; incluirNaoAptas?: boolean; agora?: Date }): Promise<(PreviaDeConfirmacao & { paraId: number; nTarefas: number }) | null> {
  const agora = args.agora ?? new Date()
  const de = await prisma.usuario.findUnique({ where: { id: args.deUsuarioId }, select: { id: true, nome: true } })
  if (!de) return null
  const paraId = args.paraUsuarioId ?? (await sugerirSucessor(args.deUsuarioId, agora))?.usuarioId ?? null
  if (paraId == null || paraId === args.deUsuarioId) return null
  const para = await prisma.usuario.findUnique({ where: { id: paraId }, select: { id: true, nome: true } })
  if (!para) return null
  const linhas = (await listarTarefasDaTorre({}, agora)).linhas
  const minhas = linhas.filter((l) => l.responsavelId === args.deUsuarioId && l.estadoOperacao !== 'CONCLUIDA')
  if (minhas.length === 0) return null
  const aptas = args.incluirNaoAptas ? new Set(minhas.map((l) => l.taskId)) : await quemAbsorve(minhas.map((l) => l.taskId), paraId, agora)
  const aMover = minhas.filter((l) => aptas.has(l.taskId))
  if (aMover.length === 0) return null
  const titulos = aMover.map((l) => `${l.titulo}${l.familiaNome ? ` · ${l.familiaNome}` : ''}`)
  return {
    pergunta: `Mover ${aMover.length} ${plural(aMover.length, 'tarefa', 'tarefas')} de ${de.nome} para ${para.nome}?`,
    itens: [{ pessoa: `${de.nome} → ${para.nome}`, quantidade: aMover.length, tarefas: titulos }],
    assinatura: aMover.map((l) => `${l.taskId}:${paraId}`).sort().join(','), paraId, nTarefas: aMover.length,
  }
}

/** O que "Redistribuir" faria agora: o excesso de quem passou do limite + as sem dono por aptidão e carga. `null` = nada a fazer. */
export async function previaDeRedistribuir(agora = new Date()): Promise<PreviaDeConfirmacao | null> {
  const linhas = (await listarTarefasDaTorre({}, agora)).linhas
  const s = await sugestaoDeRedistribuicao(linhas, await lerOrganizacao(agora), agora)
  if (!s.temAcao) return null
  const itens = [
    ...s.movimentos.map((m) => ({ pessoa: `${m.deNome} → ${m.paraNome}`, quantidade: m.quantidade, tarefas: [`excesso de ${m.excesso} acima do limite`] })),
    ...s.semResponsavel.porPessoa.map((p) => ({ pessoa: `sem responsável → ${p.nome}`, quantidade: p.quantidade, tarefas: ['aptidão comprovada e menor carga'] })),
  ]
  const total = itens.reduce((n, i) => n + i.quantidade, 0)
  return {
    pergunta: `Redistribuir ${total} ${plural(total, 'tarefa', 'tarefas')}: ${itens.map((i) => `${i.quantidade} ${i.pessoa}`).join('; ')}?`,
    itens, assinatura: itens.map((i) => `${i.pessoa}=${i.quantidade}`).join('|'),
  }
}
