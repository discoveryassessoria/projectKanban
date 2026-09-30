"use client"
// src/components/torre/TorreCabecalho.tsx — a barra do topo da Torre (Bloco J2): nacionalidade (países CADASTRADOS),
// busca, Briefing do dia e Revisar o dia. A data, o usuário e o perfil ficam no subtítulo do cabeçalho da página.
export interface PaisDaTorre { chave: string; rotulo: string; bandeira: string | null }

export function TorreCabecalho({ paises, pais, onPais, busca, onBusca, nPrecisa, onBriefing, onRevisar }: {
  paises: PaisDaTorre[]; pais: string; onPais: (chave: string) => void; busca: string; onBusca: (t: string) => void
  nPrecisa: number | null; onBriefing: () => void; onRevisar: () => void
}) {
  return (
    <div className="tor-cab">
      <select className="tor-in" aria-label="Nacionalidade" value={pais} onChange={(e) => onPais(e.target.value)}>
        <option value="">Todas as nacionalidades</option>
        {paises.map((p) => <option key={p.chave} value={p.chave}>{p.bandeira ? `${p.bandeira} ` : ""}{p.rotulo}</option>)}
      </select>
      <input className="tor-in tor-cab-busca" aria-label="Buscar" placeholder="Buscar família, pessoa, cartório, tarefa…" value={busca} onChange={(e) => onBusca(e.target.value)} />
      <div className="tor-cab-btns">
        <button className="tor-btn" onClick={onBriefing}>☀ Briefing do dia</button>
        <button className="tor-btn" onClick={onRevisar} disabled={!nPrecisa}>▶ Revisar o dia ({nPrecisa ?? "…"})</button>
      </div>
    </div>
  )
}
