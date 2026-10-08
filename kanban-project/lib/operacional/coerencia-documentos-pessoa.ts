// lib/operacional/coerencia-documentos-pessoa.ts
// ============================================================================
// O VIGIA DOS DOCUMENTOS POR PESSOA (regra «o», 08/10/2026). SOMENTE LEITURA.
// Caso Fogli: o casamento estava no nome do Sebastião (dispensado) enquanto o painel da Ilaine o contava e a aba Documentos dela não o mostrava.
// Aqui, para cada pessoa de cada processo ativo, as telas são comparadas ENTRE SI a partir da regra única (`titularDaUniao`):
//   • aba Documentos / bolinha da árvore / Torre → documentos pelo titular (`Documento.pessoaId`) e tarefas abertas dele;
//   • painel lateral (Resumo operacional) → necessidades da pessoa + as das uniões de que ela é DONO.
// Reprova: casamento fora do dono · pessoa dispensada com exigência aberta · painel × aba × Torre divergentes.
// ============================================================================
import { prisma } from '@/lib/prisma'
import { SELECT_UNIAO_PARA_TITULAR, titularDaUniao } from '@/src/services/genealogia/titular-uniao'

export interface DivergenciaDocumentoPessoa {
  processoId: number
  familia: string
  pessoa: string
  certidao: string | null
  documentoId: number | null
  detalhe: string
}

const DOC_FORA = ['CANCELADO', 'NAO_EXIGIDO']
const TAREFA_ENCERRADA = ['CONCLUIDO_RECEBIDO', 'CONCLUIDO_NAO_POSSUI', 'CANCELADA', 'SUPERSEDIDA']
const nm = (p: { nome: string; sobrenome: string | null } | null | undefined) => (p ? [p.nome, p.sobrenome].filter(Boolean).join(' ') : '—')

export async function divergenciasDeDocumentosPorPessoa(): Promise<DivergenciaDocumentoPessoa[]> {
  const processos = await prisma.processo.findMany({ where: { dataConclusao: null, arvoreId: { not: null }, NOT: { faseAtualKey: 'finalizado' } }, select: { id: true, nome: true, arvoreId: true } })
  const out: DivergenciaDocumentoPessoa[] = []
  for (const pr of processos) {
    const pessoas = await prisma.pessoa.findMany({ where: { arvoreId: pr.arvoreId }, select: { id: true, nome: true, sobrenome: true, linhaReta: true, documentacao: true } })
    const nec = await prisma.necessidadeDocumental.findMany({
      where: { processoId: pr.id, status: { not: 'DISPENSADA' } },
      select: { id: true, pessoaId: true, uniaoId: true, itemCatalogo: { select: { name: true } }, uniao: { select: SELECT_UNIAO_PARA_TITULAR }, documentos: { select: { id: true, pessoaId: true, status: true } } },
    })
    const tarefas = await prisma.tarefa.findMany({ where: { processoId: pr.id, pessoaId: { not: null }, statusTarefa: { notIn: TAREFA_ENCERRADA as never[] } }, select: { id: true, titulo: true, pessoaId: true, documentoId: true, necessidadeId: true } })
    const nomeDe = new Map(pessoas.map((p) => [p.id, nm(p)]))
    const docsVivos = nec.flatMap((n) => n.documentos.filter((d) => !DOC_FORA.includes(String(d.status))).map((d) => ({ ...d, nec: n })))
    for (const p of pessoas) {
      const dispensada = !p.linhaReta && p.documentacao !== true
      // aba Documentos / árvore / Torre: documentos no nome da pessoa
      const aba = new Set(docsVivos.filter((d) => d.pessoaId === p.id).map((d) => d.id))
      // painel: necessidades da pessoa + as das uniões de que ela é o dono
      const painel = new Set(docsVivos.filter((d) => (d.nec.pessoaId === p.id) || (d.nec.uniaoId != null && titularDaUniao(d.nec.uniao) === p.id)).map((d) => d.id))
      for (const id of aba) if (!painel.has(id)) out.push({ processoId: pr.id, familia: pr.nome, pessoa: nm(p), certidao: docsVivos.find((d) => d.id === id)?.nec.itemCatalogo?.name ?? null, documentoId: id, detalhe: 'a aba Documentos mostra, o painel não conta (documento no nome de quem não é o dono)' })
      for (const id of painel) if (!aba.has(id)) out.push({ processoId: pr.id, familia: pr.nome, pessoa: nm(p), certidao: docsVivos.find((d) => d.id === id)?.nec.itemCatalogo?.name ?? null, documentoId: id, detalhe: 'o painel conta, a aba Documentos não mostra (documento no nome de outro cônjuge)' })
      // Torre: tarefa aberta no nome da pessoa cujo documento é de outra
      for (const t of tarefas.filter((x) => x.pessoaId === p.id && x.documentoId != null)) {
        if (!aba.has(t.documentoId!) && docsVivos.some((d) => d.id === t.documentoId)) out.push({ processoId: pr.id, familia: pr.nome, pessoa: nm(p), certidao: t.titulo, documentoId: t.documentoId, detalhe: `a Torre tem a tarefa ${t.id} no nome desta pessoa, mas o documento é de outra` })
      }
      // dispensada com exigência aberta
      if (dispensada) {
        for (const d of docsVivos.filter((x) => x.pessoaId === p.id)) out.push({ processoId: pr.id, familia: pr.nome, pessoa: nm(p), certidao: d.nec.itemCatalogo?.name ?? null, documentoId: d.id, detalhe: 'pessoa dispensada (sem necessidade de documento) com certidão exigida em seu nome' })
        for (const t of tarefas.filter((x) => x.pessoaId === p.id)) out.push({ processoId: pr.id, familia: pr.nome, pessoa: nm(p), certidao: t.titulo, documentoId: t.documentoId, detalhe: `pessoa dispensada com a tarefa aberta ${t.id}` })
      }
    }
    // casamento fora do dono
    for (const n of nec) {
      if (n.uniaoId == null) continue
      const dono = titularDaUniao(n.uniao)
      for (const d of n.documentos) if (dono != null && d.pessoaId !== dono && !DOC_FORA.includes(String(d.status))) out.push({ processoId: pr.id, familia: pr.nome, pessoa: nomeDe.get(d.pessoaId) ?? `#${d.pessoaId}`, certidao: n.itemCatalogo?.name ?? null, documentoId: d.id, detalhe: `casamento fora do dono: o dono é ${nomeDe.get(dono) ?? '#' + dono}` })
    }
  }
  return out
}
