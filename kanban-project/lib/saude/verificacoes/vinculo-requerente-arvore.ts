// lib/saude/verificacoes/vinculo-requerente-arvore.ts — INT-004: o vínculo Requerente × Pessoa × Processo.
// SOMENTE LEITURA (só SELECT; nunca corrige). O dono do vínculo é `src/services/processo-requerentes.ts`; esta verificação existe para acusar o que
// escapou (dado antigo, ou um caminho novo que ignorou o dono). Quatro casos:
//   A  requerente ATIVO de processo com árvore, sem pessoa válida na árvore (personId vazio ou pessoa removida);
//   B  pessoa marcada como requerente sem Requerente ligado (B1), com Requerente que não está no processo daquela árvore (B2), ou o inverso (B3);
//   C  vínculo cruzado ou nome divergente: o nome do Requerente não é o da Pessoa (par trocado A↔B e nascimento diferente = ERRO; só grafia = ALERTA);
//   D  Requerente de processo ligado a uma pessoa da árvore de OUTRO processo.
import { prisma } from '@/lib/prisma'
import { registrar } from '../catalogo'
import type { Achado, ResultadoVerificacao, Severidade } from '../tipos'
import { ehFlagDeRequerente } from '@/src/services/processo-requerentes'
import { PESSOA_ATIVA, VINCULO_PROCESSO_ATIVO } from '@/src/lib/genealogia/vinculo-ativo'

export type CasoDoVinculo = 'A' | 'B1' | 'B2' | 'B3' | 'C' | 'D'
export interface ViolacaoDoVinculo {
  caso: CasoDoVinculo
  severidade: Severidade
  processoId: number | null
  processo: string
  familia: string
  requerente: string
  pessoa: string | null
  detalhe: string
  entidade: 'Requerente' | 'Pessoa'
  registroId: number
}

export const TITULO_DO_CASO: Record<CasoDoVinculo, string> = {
  A: 'Requerente do processo sem pessoa válida na árvore',
  B1: 'Pessoa marcada como requerente sem requerente ligado',
  B2: 'Pessoa requerente cujo requerente não está no processo da árvore',
  B3: 'Requerente do processo ligado a pessoa da árvore que não é requerente',
  C: 'Nome do requerente diferente do da pessoa ligada (vínculo cruzado ou grafia)',
  D: 'Requerente ligado a pessoa da árvore de outro processo',
}

// ─── nomes (puro) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e'])
/** Palavras do nome sem acento, caixa nem partículas («Maria da Silva» → [maria, silva]). */
export function palavrasDoNome(n: string | null | undefined): string[] {
  return (n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !PARTICULAS.has(w))
}
const chaveDoNome = (n: string | null | undefined) => [...palavrasDoNome(n)].sort().join(' ')
export const mesmoNome = (a: string | null | undefined, b: string | null | undefined) => chaveDoNome(a) === chaveDoNome(b)

/** Como classificar a diferença entre o nome do requerente e o da pessoa. `null` = mesmo nome. */
export function severidadeDaDiferencaDeNome(a: { nomeReq: string; nomePessoa: string; nascReq: Date | null; nascPessoa: Date | null; trocado: boolean }): Severidade | null {
  if (mesmoNome(a.nomeReq, a.nomePessoa)) return null
  if (a.trocado) return 'ERRO'
  if (a.nascReq && a.nascPessoa && a.nascReq.toISOString().slice(0, 10) !== a.nascPessoa.toISOString().slice(0, 10)) return 'ERRO'
  const [pr, pp] = [palavrasDoNome(a.nomeReq), palavrasDoNome(a.nomePessoa)]
  if (pr[0] !== pp[0]) return 'ERRO' // primeiro nome diferente: outra pessoa
  return 'ALERTA' // mesmo primeiro nome, mesma data (ou sem data): sobrenome de casada, «Banho» a mais…
}

const nomePessoa = (p: { nome: string; sobrenome: string | null }) => [p.nome, p.sobrenome].filter(Boolean).join(' ').trim()

export async function detectarVinculosDeRequerente(): Promise<ViolacaoDoVinculo[]> {
  const out: ViolacaoDoVinculo[] = []
  const vinculos = await prisma.processoRequerente.findMany({
    where: { ...VINCULO_PROCESSO_ATIVO },
    select: {
      processoId: true, requerenteId: true,
      processo: { select: { id: true, nome: true, codigo: true, arvoreId: true, arvore: { select: { nome: true } } } },
      requerente: { select: { id: true, nome: true, dataNascimento: true, personId: true, pessoa: { select: { id: true, nome: true, sobrenome: true, arvoreId: true, removidaEm: true, requerente: true, data_nasc: true, arvore: { select: { nome: true } } } } } },
    },
  })
  const rotuloProcesso = (p: (typeof vinculos)[number]['processo']) => `${p.codigo ?? `#${p.id}`} ${p.nome}`
  const familiaDe = (p: (typeof vinculos)[number]['processo']) => p.arvore?.nome ?? p.nome
  const porProcesso = new Map<number, typeof vinculos>()
  for (const v of vinculos) porProcesso.set(v.processoId, [...(porProcesso.get(v.processoId) ?? []), v])

  for (const v of vinculos) {
    const { processo: proc, requerente: r } = v
    const pes = r.pessoa
    const base = { processoId: proc.id, processo: rotuloProcesso(proc), familia: familiaDe(proc), requerente: r.nome, entidade: 'Requerente' as const, registroId: r.id }
    if (proc.arvoreId != null && (r.personId == null || !pes || pes.removidaEm != null)) {
      out.push({ ...base, caso: 'A', severidade: 'ERRO', pessoa: pes ? nomePessoa(pes) : null, detalhe: r.personId == null ? 'o requerente não tem pessoa na árvore' : 'a pessoa ligada ao requerente foi removida da árvore' })
      continue
    }
    if (!pes) continue
    if (pes.arvoreId != null && pes.arvoreId !== proc.arvoreId) {
      out.push({ ...base, caso: 'D', severidade: 'ERRO', pessoa: nomePessoa(pes), detalhe: `o requerente aponta para uma pessoa da ${pes.arvore?.nome ?? `árvore #${pes.arvoreId}`}, que não é a árvore deste processo${proc.arvoreId == null ? ' (o processo não tem árvore)' : ''}` })
      continue
    }
    if (proc.arvoreId != null && pes.arvoreId === proc.arvoreId && !ehFlagDeRequerente(pes.requerente)) {
      out.push({ ...base, caso: 'B3', severidade: 'ERRO', pessoa: nomePessoa(pes), detalhe: `o requerente está no processo, mas a pessoa ligada está marcada como «${pes.requerente ?? 'nao'}» na árvore` })
    }
    // C — o par trocado: outro requerente do MESMO processo cujo nome é o da pessoa deste, e o nome deste é o da pessoa dele.
    const colegas = porProcesso.get(proc.id) ?? []
    const trocado = colegas.some((o) => o.requerenteId !== r.id && o.requerente.pessoa && mesmoNome(o.requerente.nome, nomePessoa(pes)) && mesmoNome(r.nome, nomePessoa(o.requerente.pessoa)))
    const sev = severidadeDaDiferencaDeNome({ nomeReq: r.nome, nomePessoa: nomePessoa(pes), nascReq: r.dataNascimento, nascPessoa: pes.data_nasc, trocado })
    if (sev) out.push({ ...base, caso: 'C', severidade: sev, pessoa: nomePessoa(pes), detalhe: trocado ? `vínculo CRUZADO: o nome do requerente é o de outra pessoa do mesmo processo (trocados entre si)` : `nome do requerente «${r.nome}» ≠ nome da pessoa «${nomePessoa(pes)}»${sev === 'ALERTA' ? ' (só grafia)' : ''}` })
  }

  // B1 e B2 — partem da PESSOA marcada como requerente.
  const marcadas = await prisma.pessoa.findMany({
    where: { ...PESSOA_ATIVA, arvoreId: { not: null }, requerente: { in: ['sim', 'maior', 'menor'] } },
    select: { id: true, nome: true, sobrenome: true, arvoreId: true, arvore: { select: { nome: true } } },
  })
  if (marcadas.length) {
    const reqs = await prisma.requerente.findMany({ where: { personId: { in: marcadas.map((p) => p.id) } }, select: { id: true, nome: true, personId: true, processos: { where: { ...VINCULO_PROCESSO_ATIVO }, select: { processo: { select: { arvoreId: true } } } } } })
    const reqDe = new Map(reqs.map((r) => [r.personId as number, r]))
    for (const p of marcadas) {
      const r = reqDe.get(p.id)
      const base = { processoId: null, processo: '—', familia: p.arvore?.nome ?? `árvore #${p.arvoreId}`, pessoa: nomePessoa(p), entidade: 'Pessoa' as const, registroId: p.id }
      if (!r) out.push({ ...base, caso: 'B1', severidade: 'ERRO', requerente: '—', detalhe: 'a pessoa está marcada como requerente, mas nenhum requerente aponta para ela' })
      else if (!r.processos.some((x) => x.processo.arvoreId === p.arvoreId)) out.push({ ...base, caso: 'B2', severidade: 'ERRO', requerente: r.nome, detalhe: 'a pessoa é requerente na árvore, mas o requerente dela não está em nenhum processo desta árvore' })
    }
  }
  return out
}

registrar({
  id: 'saude.integridade.vinculo-requerente-arvore',
  codigo: 'INT-004',
  nome: 'Vínculo Requerente × Pessoa × Processo',
  descricao: 'Acusa requerente de processo sem pessoa na árvore; pessoa marcada como requerente sem vínculo ao processo; vínculos cruzados ou nome divergente; e requerente ligado a pessoa da árvore de outro processo. Somente leitura.',
  dominio: 'ARVORE',
  modulo: 'Genealogia',
  severidadePadrao: 'ERRO',
  obrigatoria: true,
  modos: ['RAPIDO', 'COMPLETO', 'PROFUNDO'],
  introduzidaEm: '1.14.0',
  timeoutMs: 60_000,
  orientacao: 'Cada achado nomeia requerente, pessoa, família e processo. Nada é corrigido sozinho: o vínculo só muda pelo serviço único (processo-requerentes.ts), por decisão de quem conhece o caso.',
  rotaCorrecao: '/torre',
  correcaoAutomatica: null,
  responsavel: 'Genealogia',
  ativo: true,
  executar: async (): Promise<ResultadoVerificacao> => {
    const violacoes = await detectarVinculosDeRequerente()
    const achados: Achado[] = violacoes.map((v) => ({
      chave: `INT-004:${v.caso}:${v.entidade}:${v.registroId}:${v.processoId ?? 0}`,
      severidade: v.severidade,
      titulo: `${TITULO_DO_CASO[v.caso]}: ${v.requerente}${v.pessoa ? ` ↔ ${v.pessoa}` : ''} (família ${v.familia} · processo ${v.processo})`,
      descricao: v.detalhe,
      entidade: v.entidade, registroId: String(v.registroId), registroNome: `${v.requerente}${v.pessoa ? ` ↔ ${v.pessoa}` : ''}`,
      link: v.processoId ? `/torre/processo/${v.processoId}` : '/torre',
      recomendacao: 'Somente leitura: confira o caso e decida; o vigia nunca troca vínculo sozinho.',
      evidencia: { caso: v.caso, processoId: v.processoId, familia: v.familia, requerente: v.requerente, pessoa: v.pessoa },
    }))
    const porCaso: Record<string, number> = {}
    for (const v of violacoes) porCaso[v.caso] = (porCaso[v.caso] ?? 0) + 1
    return { achados, metricas: { violacoes: violacoes.length, ...porCaso }, resumo: violacoes.length === 0 ? 'Nenhum vínculo requerente × pessoa × processo fora do lugar.' : `${violacoes.length} vínculo(s) requerente × pessoa × processo para conferir.` }
  },
})
