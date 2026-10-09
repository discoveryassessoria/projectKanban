"use client"
// src/components/localidade/campos-de-localidade.tsx
// ============================================================================
// A FERRAMENTA DE LOCALIDADE, UMA SÓ (09/10/2026): País → Estado/Província → Cidade, a mesma da Genealogia («Editar dados registrais»).
//   Brasil → estados e cidades do IBGE (listas) · qualquer outro país → PROVÍNCIA da base do servidor e cidade sugerida (texto livre sempre vale).
// Todo lugar que pede onde algo aconteceu — nascimento, casamento e óbito na árvore, o registro na Genealogia — usa ESTE componente; nenhum tem lista própria.
// Quem usa só desenha o que ele devolve: o carregamento é do hook `lib/localidade/use-localidade.ts`; a regra (Estado × Província), de `regra-localidade.ts`.
// O valor GRAVADO nunca é reescrito por abrir a tela: «SP» antigo continua «SP» até alguém escolher outro estado (só a lista de cidades reconhece a sigla).
// ============================================================================
import { type ReactNode } from "react"
import { useLocalidade } from "@/lib/localidade/use-localidade"
import { nomeDaUf } from "@/lib/localidade/ufs"

export interface LocalidadeValor { pais: string; estado: string; cidade: string }
type Campo = "pais" | "estado" | "cidade"

export function CamposDeLocalidade({
  valor, onChange, ativo = true, rotulos, classeDoRotulo, classeDoCampo, classeDaCelula = "", idPrefixo, testIdPrefixo = "", nomes = { pais: "pais", estado: "estado", cidade: "cidade" },
  envolver, dataCampo, larguraDaCidade, campos = ["pais", "estado", "cidade"],
}: {
  valor: LocalidadeValor
  onChange: (v: LocalidadeValor) => void
  ativo?: boolean
  /** Rótulos de cada campo; o da divisão recebe «Estado»/«Província» da regra. */
  rotulos: { pais: string; divisao: (rotuloDaDivisao: string) => string; cidade: string }
  classeDoRotulo: string
  classeDoCampo: string
  classeDaCelula?: string
  idPrefixo: string
  testIdPrefixo?: string
  nomes?: Record<Campo, string>
  /** Embrulha cada campo (ex.: a trava «veio do registro» da árvore). */
  envolver?: (campo: Campo, conteudo: ReactNode) => ReactNode
  dataCampo?: Partial<Record<Campo, string>>
  /** Classe extra só da célula da cidade (ex.: `col-span-2`). */
  larguraDaCidade?: string
  /** Quais campos desenhar (padrão: os três). Uma tela que só pergunta o país pede só `["pais"]` — a lista e a regra continuam as mesmas. */
  campos?: Campo[]
}) {
  const estadoParaLista = nomeDaUf(valor.estado) ?? valor.estado // «SP» antigo carrega as cidades de São Paulo, sem reescrever o que está gravado
  const loc = useLocalidade({ ativo, pais: valor.pais, estadoOuProvincia: estadoParaLista, cidade: valor.cidade })
  const embrulhar = (c: Campo, n: ReactNode) => (envolver ? envolver(c, n) : n)
  const nomesDasDivisoes = loc.ehBrasil ? loc.ufs.map((u) => u.nome) : loc.provincias.map((p) => p.nome)
  const divisaoMostrada = loc.ehBrasil ? estadoParaLista : valor.estado
  const id = (c: Campo) => `${idPrefixo}${nomes[c]}`
  const tid = (c: Campo) => `${testIdPrefixo}${nomes[c]}`

  return (
    <>
      {campos.includes("pais") && <div className={classeDaCelula} data-campo={dataCampo?.pais}>
        <label className={classeDoRotulo} htmlFor={id("pais")}>{rotulos.pais}</label>
        {embrulhar("pais", (
          <select id={id("pais")} data-testid={tid("pais")} className={classeDoCampo} value={valor.pais} onChange={(e) => onChange({ pais: e.target.value, estado: "", cidade: "" })}>
            <option value="">{loc.paises.length ? "Selecione o país" : "Carregando…"}</option>
            {valor.pais && !loc.paises.some((p) => p.nome === valor.pais) && <option value={valor.pais}>{valor.pais}</option>}
            {loc.paises.map((p) => <option key={p.codigo} value={p.nome}>{p.nome}</option>)}
          </select>
        ))}
      </div>}
      {campos.includes("estado") && <div className={classeDaCelula} data-campo={dataCampo?.estado}>
        <label className={classeDoRotulo} htmlFor={id("estado")}>{rotulos.divisao(loc.rotuloDivisao)}</label>
        {embrulhar("estado", loc.ehBrasil || loc.provincias.length > 0 ? (
          <select id={id("estado")} data-testid={tid("estado")} className={classeDoCampo} value={divisaoMostrada} onChange={(e) => onChange({ ...valor, estado: e.target.value, cidade: "" })}>
            <option value="">{`Selecione ${loc.ehBrasil ? "o estado" : "a província"}`}</option>
            {divisaoMostrada && !nomesDasDivisoes.includes(divisaoMostrada) && <option value={divisaoMostrada}>{divisaoMostrada}</option>}
            {nomesDasDivisoes.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        ) : (
          <input id={id("estado")} data-testid={tid("estado")} className={classeDoCampo} type="text" maxLength={50} value={valor.estado} onChange={(e) => onChange({ ...valor, estado: e.target.value })} />
        ))}
      </div>}
      {campos.includes("cidade") && <div className={`${classeDaCelula} ${larguraDaCidade ?? ""}`.trim()} data-campo={dataCampo?.cidade}>
        <label className={classeDoRotulo} htmlFor={id("cidade")}>{rotulos.cidade}</label>
        {embrulhar("cidade", loc.ehBrasil && loc.municipios.length > 0 ? (
          <select id={id("cidade")} data-testid={tid("cidade")} className={classeDoCampo} value={valor.cidade} onChange={(e) => onChange({ ...valor, cidade: e.target.value })}>
            <option value="">Selecione a cidade</option>
            {valor.cidade && !loc.municipios.includes(valor.cidade) && <option value={valor.cidade}>{valor.cidade}</option>}
            {loc.municipios.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <>
            {/* Fora do Brasil a lista só SUGERE; cidade que a base não conhece é texto livre (nunca trava). */}
            <input id={id("cidade")} data-testid={tid("cidade")} className={classeDoCampo} type="text" maxLength={100} list={`${idPrefixo}cidades-sugeridas`} value={valor.cidade} onChange={(e) => onChange({ ...valor, cidade: e.target.value })} />
            <datalist id={`${idPrefixo}cidades-sugeridas`}>{loc.cidadesSugeridas.map((c) => <option key={`${c.nome}|${c.provincia}`} value={c.nome}>{c.provincia ? `${c.nome} — ${c.provincia}` : c.nome}</option>)}</datalist>
          </>
        ))}
      </div>}
    </>
  )
}
