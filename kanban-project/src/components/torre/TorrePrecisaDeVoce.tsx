"use client"
// src/components/torre/TorrePrecisaDeVoce.tsx — aba PRECISA DE VOCÊ (Bloco J4 · motor do Bloco F).
// Decisões que só o Administrador toma, ordenadas por score (maior risco primeiro), cada linha com a ação embutida.
import { useState } from "react"
import { ROTULO_TIPO, PILL_DA_FAIXA, type ItemPrecisa } from "./tipos-precisa"
import { useAcoesDoItem } from "./acoes-do-item"

export function TorrePrecisaDeVoce({ itens, carregando, erro, irParaAba }: {
  itens: ItemPrecisa[] | null; carregando: boolean; erro: string | null; irParaAba: (aba: "equipe") => void
}) {
  const { executar, modais } = useAcoesDoItem({ irParaAba })
  const [ocupado, setOcupado] = useState<string | null>(null)

  if (erro) return <div className="tor-card pad">{erro}</div>
  if (carregando || itens == null) return <div className="tor-card pad small">Carregando as decisões…</div>

  const rodar = async (item: ItemPrecisa, qual: 1 | 2, chave: string) => {
    setOcupado(chave)
    try { await executar(item, qual) } finally { setOcupado(null) }
  }

  return (
    <div>
      <div className="small mb-2">Decisões que só o Administrador toma. Cada linha tem a ação embutida. O score ordena: maior risco primeiro.</div>
      {itens.length === 0 ? (
        <div className="tor-card" style={{ padding: 40, textAlign: "center" }}><b style={{ fontSize: 16, color: "var(--success-text)" }}>Nada depende de você agora.</b></div>
      ) : (
        <div className="tor-card tor-scroll">
          <div className="tor-hd tor-gP"><span>Tipo</span><span>O que está acontecendo</span><span>Sugestão do sistema</span><span>Ação</span></div>
          {itens.map((it, i) => {
            const chave = `${i}:${it.tipo}:${it.tarefaId ?? it.processoId ?? ""}`
            return (
              <div key={chave} className="tor-row tor-gP">
                <span className={`tor-p ${PILL_DA_FAIXA[it.faixa]}`} style={{ justifySelf: "start" }}>{ROTULO_TIPO[it.tipo] ?? it.tipo}</span>
                <div><b>{it.titulo}</b><div className="small">{it.detalhe}</div></div>
                <div className="small">{it.sugestao ?? "—"}</div>
                <div className="flex flex-wrap gap-1.5">
                  <button className="tor-btn pri" disabled={ocupado === chave} onClick={() => void rodar(it, 1, chave)}>{it.acao1.rotulo}</button>
                  <button className="tor-btn" disabled={ocupado === chave} onClick={() => void rodar(it, 2, chave)}>{it.acao2.rotulo}</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {modais}
    </div>
  )
}
