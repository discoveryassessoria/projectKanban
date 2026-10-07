"use client"
// src/components/torre/lote-atribuicao.tsx — as AÇÕES EM LOTE DE ATRIBUIÇÃO: "Atribuir a [pessoa (carga)]", "Remover responsável" e (onde faz sentido) "Atribuir às sugeridas".
// UM SÓ código para a aba Tarefas e para a tabela da página do processo: as duas telas se comportam igual (mesma lista de pessoas com a carga, mesma
// confirmação com a lista "certidão · pessoa · família", mesma confirmação extra para tarefa já iniciada, mesma porta `/api/torre/tarefas/lote`).
import { useEffect, useState, type ReactNode } from "react"
import { api, erroDe, type Desfazer } from "./torre-base"
import { useConfirmarAtribuicao } from "./ConfirmarAtribuicao"

export interface PessoaDoLote { id: number; nome: string; email?: string; tarefasAtivas: number }
interface RespLote { total?: number; sucesso?: number; falha?: number; itens?: Array<{ ok: boolean; mensagem?: string }>; desfazer?: Desfazer | null; error?: string; mensagem?: string }

const sufixoDasFalhas = (itens: RespLote["itens"]): string => {
  const falhas = (itens ?? []).filter((i) => !i.ok)
  return falhas.length ? ` · ${falhas.length} não passou(aram): ${falhas[0].mensagem ?? "recusada"}` : ""
}

export type AcaoDeLoteDeAtribuicao = "ATRIBUIR" | "REMOVER_RESPONSAVEL" | "ATRIBUIR_SUGERIDAS"

export interface LoteDeAtribuicao {
  pessoas: PessoaDoLote[]
  pessoaId: number | null
  setPessoaId: (id: number | null) => void
  pessoa: PessoaDoLote | undefined
  ocupado: boolean
  /** Roda a ação: 1ª viagem devolve a prévia (428) → modal de confirmação → 2ª viagem grava. Devolve `true` se gravou. */
  executar: (acao: AcaoDeLoteDeAtribuicao, ids: number[]) => Promise<boolean>
  modal: ReactNode
}

export function useLoteDeAtribuicao({ podeEditar, onResultado, preEscolher = true }: {
  podeEditar: boolean
  /** `false` = a lista começa em "— escolha a pessoa —", sem ninguém pré-escolhido (a página do processo). */
  preEscolher?: boolean
  /** O que cada tela faz com o resultado (aviso + "Desfazer", limpar a seleção, recarregar). */
  onResultado: (mensagem: string, desfazer: Desfazer | null) => void
}): LoteDeAtribuicao {
  const [pessoas, setPessoas] = useState<PessoaDoLote[]>([])
  const [pessoaId, setPessoaIdEstado] = useState<number | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const { postar, modal } = useConfirmarAtribuicao()

  useEffect(() => {
    if (!podeEditar) return
    let vivo = true
    void api<{ funcionarios: PessoaDoLote[] }>("/api/operacao/atribuiveis").then((r) => {
      if (vivo && r.ok) { setPessoas(r.data.funcionarios ?? []); setPessoaIdEstado((atual) => atual ?? (preEscolher ? r.data.funcionarios?.[0]?.id ?? null : null)) }
    })
    return () => { vivo = false }
  }, [podeEditar, preEscolher])

  const pessoa = pessoas.find((p) => p.id === pessoaId)

  const executar = async (acao: AcaoDeLoteDeAtribuicao, ids: number[]): Promise<boolean> => {
    if (acao === "ATRIBUIR" && !pessoa) return false
    setOcupado(true)
    const r = await postar<RespLote>("/api/torre/tarefas/lote", { acao, tarefaIds: ids, ...(acao === "ATRIBUIR" ? { responsavelId: pessoaId } : {}) })
    setOcupado(false)
    if (r.data && typeof r.data.total === "number") {
      const n = r.data.sucesso ?? 0
      const msg = acao === "ATRIBUIR" ? `${n} ${n === 1 ? "tarefa atribuída" : "tarefas atribuídas"} a ${pessoa?.nome ?? "a pessoa"}`
        : acao === "ATRIBUIR_SUGERIDAS" ? `${n} ${n === 1 ? "tarefa atribuída" : "tarefas atribuídas"} às sugeridas`
          : `Responsável removido de ${n} ${n === 1 ? "tarefa" : "tarefas"} — voltaram à fila de distribuição`
      onResultado(`${msg}${sufixoDasFalhas(r.data.itens)} · fica no histórico`, r.data.desfazer ?? null)
      return true
    }
    onResultado(erroDe(r.data), null)
    return false
  }

  return { pessoas, pessoaId, setPessoaId: setPessoaIdEstado, pessoa, ocupado, executar, modal }
}

/** Os controles da barra de seleção: "Atribuir a [pessoa (carga)] [Atribuir]", "Remover responsável" e, se pedido, "Atribuir às sugeridas". */
export function AcoesDeAtribuicaoEmLote({ lote, ids, ocupado = false, comSugeridas = false, depois }: {
  lote: LoteDeAtribuicao; ids: number[]; ocupado?: boolean; comSugeridas?: boolean
  /** Depois de gravar (ex.: limpar a seleção). */
  depois?: () => void
}) {
  const semSelecao = ids.length === 0
  const bloqueado = ocupado || lote.ocupado || semSelecao
  const rodar = (acao: AcaoDeLoteDeAtribuicao) => async () => { if (await lote.executar(acao, ids)) depois?.() }
  return (
    <>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Atribuir a
        <select aria-label="Atribuir a" value={lote.pessoaId ?? ""} onChange={(e) => lote.setPessoaId(e.target.value === "" ? null : Number(e.target.value))}>
          <option value="">— escolha a pessoa —</option>
          {lote.pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome} ({p.tarefasAtivas} {p.tarefasAtivas === 1 ? "ativa" : "ativas"})</option>)}
        </select>
        <button type="button" disabled={bloqueado || !lote.pessoa} onClick={() => void rodar("ATRIBUIR")()}>Atribuir</button>
      </span>
      <button type="button" disabled={bloqueado} title="Devolve as selecionadas à fila de distribuição (fica no histórico)" onClick={() => void rodar("REMOVER_RESPONSAVEL")()}>Remover responsável</button>
      {comSugeridas && <button type="button" disabled={bloqueado} title="Atribui a quem o sistema sugere (aptidão comprovada); mostra a lista antes de gravar" onClick={() => void rodar("ATRIBUIR_SUGERIDAS")()}>Atribuir às sugeridas</button>}
      {lote.modal}
    </>
  )
}
