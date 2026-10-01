"use client"
// src/components/torre/TorreCabecalho.tsx — a barra do topo da Torre (Bloco J2; Torre nova, Etapa A): a NACIONALIDADE como botões
// ("Todos · Itália 280 · Espanha 140…", a contagem é de processos ativos), a busca, o "Briefing do dia" (SÓ manual — nunca abre
// sozinho) e o "Revisar o dia (N)". O SINO é o do cabeçalho global da página (`HeaderBarApp`), o mesmo de todo o sistema.
// A data, o usuário e o perfil ficam no subtítulo do cabeçalho da página. O país escolhido filtra TODAS as abas (Torre.tsx).
export interface PaisDaTorre { chave: string; rotulo: string; bandeira: string | null; /** Processos ativos do país (`null` = ainda carregando). */ n?: number | null }

export function TorreCabecalho({ paises, pais, onPais, nTodos, busca, onBusca, nPrecisa, onBriefing, onRevisar }: {
  paises: PaisDaTorre[]; pais: string; onPais: (chave: string) => void; nTodos?: number | null; busca: string; onBusca: (t: string) => void
  nPrecisa: number | null; onBriefing: () => void; onRevisar: () => void
}) {
  return (
    <div className="tor-cab">
      <div className="tor-paises" role="group" aria-label="Nacionalidade">
        <button type="button" className="tor-pais" aria-pressed={pais === ""} onClick={() => onPais("")}>
          Todos{nTodos != null ? <span className="n">{nTodos}</span> : null}
        </button>
        {paises.map((p) => (
          <button key={p.chave} type="button" className="tor-pais" aria-pressed={pais === p.chave} title={p.rotulo} onClick={() => onPais(p.chave)}>
            {p.bandeira ? `${p.bandeira} ` : ""}{p.rotulo}{p.n != null ? <span className="n">{p.n}</span> : null}
          </button>
        ))}
      </div>
      <input className="tor-in tor-cab-busca" aria-label="Buscar" placeholder="Buscar pessoa, cartório ou tarefa…" value={busca} onChange={(e) => onBusca(e.target.value)} />
      <div className="tor-cab-btns">
        <button className="tor-btn" onClick={onBriefing}>☀ Briefing do dia</button>
        <button className="tor-btn pri" onClick={onRevisar} disabled={!nPrecisa}>▶ Revisar o dia ({nPrecisa ?? "…"})</button>
      </div>
    </div>
  )
}
