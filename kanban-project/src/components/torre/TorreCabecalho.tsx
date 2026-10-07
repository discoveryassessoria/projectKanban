"use client"
// src/components/torre/TorreCabecalho.tsx — a barra do topo da Torre (Bloco J2; Torre nova, Etapa A): a NACIONALIDADE como botões
// ("Todos · Itália 280 · Espanha 140…", a contagem é de processos ativos) e a busca. (O "Briefing do dia" virou a frase de HOJE e o
// "Revisar o dia" saiu — consolidação 06/10/2026.) O SINO é o do cabeçalho global da página (`HeaderBarApp`), o mesmo de todo o sistema.
// A data, o usuário e o perfil ficam no subtítulo do cabeçalho da página. O país escolhido filtra TODAS as abas (Torre.tsx).
export interface PaisDaTorre { chave: string; rotulo: string; bandeira: string | null; /** Processos ativos do país (`null` = ainda carregando). */ n?: number | null }

/** T034: o protótipo ordena os países pelo tamanho ("Itália 280 · Espanha 140 · Portugal 55…"); empate (e contagem ainda carregando) = ordem do cadastro. */
export const paisesPorTamanho = (paises: PaisDaTorre[]): PaisDaTorre[] =>
  paises.map((p, i) => ({ p, i })).sort((a, b) => (b.p.n ?? -1) - (a.p.n ?? -1) || a.i - b.i).map((x) => x.p)

export function TorreCabecalho({ paises, pais, onPais, nTodos, busca, onBusca }: {
  paises: PaisDaTorre[]; pais: string; onPais: (chave: string) => void; nTodos?: number | null; busca: string; onBusca: (t: string) => void
}) {
  return (
    <div className="tor-cab">
      <div className="tor-paises" role="group" aria-label="Nacionalidade">
        <button type="button" className="tor-pais" aria-pressed={pais === ""} onClick={() => onPais("")}>
          Todos{nTodos != null ? <span className="n">{nTodos}</span> : null}
        </button>
        {paisesPorTamanho(paises).map((p) => (
          <button key={p.chave} type="button" className="tor-pais" aria-pressed={pais === p.chave} title={p.rotulo} onClick={() => onPais(p.chave)}>
            {p.rotulo}{p.n != null ? <span className="n">{p.n}</span> : null}
          </button>
        ))}
      </div>
      <input className="tor-in tor-cab-busca" aria-label="Buscar" placeholder="Buscar família, pessoa, cartório…" value={busca} onChange={(e) => onBusca(e.target.value)} />
    </div>
  )
}
