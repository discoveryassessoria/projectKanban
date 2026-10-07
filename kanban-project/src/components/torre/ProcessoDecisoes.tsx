"use client"
// src/components/torre/ProcessoDecisoes.tsx — "Decisões deste processo" (âncora #decisoes) — consolidação da Torre, 06/10/2026.
// As decisões que antes moravam no "Precisa de você" e que NÃO são atribuição (avançar fase, encerrar como não devida, desbloquear, cobrar,
// registrar ligação, trocar canal…) passam a viver AQUI, no processo a que pertencem — as mesmas ações, as mesmas portas (`useAcoesDoItem`).
// L4: atribuir só em Tarefas — onde a decisão pede atribuição, em vez do botão há o link "Atribuir na Torre".
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { api, erroDe } from "./torre-base"
import { useAcoesDoItem } from "./acoes-do-item"
import { ROTULO_TIPO, PILL_DO_TIPO, type ItemPrecisa } from "./tipos-precisa"
import "./precisa.css"

/** As ações que MUDAM o responsável: nunca viram botão fora da aba Tarefas (L4). */
export const ACOES_DE_ATRIBUICAO: readonly string[] = ["ATRIBUIR_SUGERIDO", "ATRIBUIR_ESCOLHIDO", "REDISTRIBUIR_CARGA"]

export function ProcessoDecisoes({ processoId, versao, onFeito }: { processoId: number; versao: number; onFeito: () => void }) {
  const [itens, setItens] = useState<ItemPrecisa[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const { executar, modais } = useAcoesDoItem({ irParaAba: () => {}, onFeito: () => onFeito() })

  useEffect(() => {
    let vivo = true
    void api<{ itens: ItemPrecisa[] }>("/api/torre/precisa-de-voce").then((r) => {
      if (!vivo) return
      if (r.ok) { setItens(r.data.itens.filter((i) => i.processoId === processoId)); setErro(null) }
      else setErro(erroDe(r.data, "Não foi possível carregar as decisões."))
    })
    return () => { vivo = false }
  }, [processoId, versao])

  const lista = useMemo(() => itens ?? [], [itens])
  const rodar = async (item: ItemPrecisa, qual: 1 | 2, chave: string) => { setOcupado(chave); try { await executar(item, qual) } finally { setOcupado(null) } }

  return (
    <div className="tpr-bloco" id="decisoes" data-testid="decisoes-do-processo">
      <div className="rot">Decisões deste processo{itens ? ` · ${lista.length}` : ""}</div>
      {erro && <div className="tpr-13 tpr-mut">{erro}</div>}
      {!erro && itens == null && <div className="tpr-13 tpr-mut">Carregando…</div>}
      {itens != null && lista.length === 0 && <div className="tpr-13 tpr-mut">Nenhuma decisão pendente neste processo.</div>}
      {lista.map((it, i) => {
        const chave = `${i}:${it.tipo}:${it.tarefaId ?? "-"}`
        const botao = (a: ItemPrecisa["acao1"], qual: 1 | 2) => ACOES_DE_ATRIBUICAO.includes(a.acao)
          ? <Link key={qual} className="pdv-b2" href="/torre?aba=tarefas&visao=semdono">Atribuir na Torre</Link>
          : <button key={qual} type="button" className={qual === 1 ? "pdv-b1" : "pdv-b2"} disabled={ocupado === chave} onClick={() => void rodar(it, qual, chave)}>{a.rotulo}</button>
        return (
          <div key={chave} className="pdv-lin" style={{ gridTemplateColumns: "140px 1fr auto" }}>
            <div><span className={`tor-p ${PILL_DO_TIPO[it.tipo]}`}>{ROTULO_TIPO[it.tipo] ?? it.tipo}</span></div>
            <div className="pdv-quem"><span>{it.colunas?.tarefa ?? it.titulo}</span>{it.colunas?.complemento && <span className="pdv-det">{it.colunas.complemento}</span>}</div>
            <div className="pdv-acoes">{botao(it.acao1, 1)}{botao(it.acao2, 2)}</div>
          </div>
        )
      })}
      {modais}
    </div>
  )
}
