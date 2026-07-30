// src/components/arvore/motor/painel-estatisticas.tsx
//
// ESTATÍSTICAS DA ÁRVORE.
//
// Equivalente da tela de estatísticas da experiência de referência: um resumo do
// que a árvore tem — quantas pessoas, quantas gerações, sobrenomes mais comuns,
// lugares mais comuns — servindo de porta de entrada por sobrenome e por lugar.
//
// Antes eu havia chamado isto de "índice" e desenhado como uma ferramenta
// própria, com filtro de realce embutido. Era invenção: o painel voltou a ser o
// que a referência tem — um sumário navegável, sem controle de filtro dentro.
//
// O agrupamento de sobrenomes é FONÉTICO, então variações de grafia aparecem
// juntas em vez de espalhadas pelo alfabeto — que é onde a duplicidade se
// esconde. Isso não é invenção de interface: é a mesma leitura de "sobrenomes
// da árvore", feita de forma que sirva a nomes de imigração.

"use client"

import { memo, useMemo, useState } from "react"
import { MapPin, Search, Users, X, AlertTriangle } from "lucide-react"
import {
  filtrarFacetas,
  type FacetaLocalidade,
  type FacetaSobrenome,
  type Facetas,
} from "@/src/lib/genealogia/motor/facetas"
import type { QualidadeArvore } from "@/src/lib/genealogia/motor/tipos"
import { EASE, SEVERIDADE_COR, TREE } from "./tokens"

export interface PainelEstatisticasProps {
  aberto: boolean
  facetas: Facetas
  qualidade: QualidadeArvore
  aoFechar: () => void
  aoIrParaPessoa: (id: number) => void
}

type Aba = "sobrenomes" | "localidades"

const ROTULO_PAPEL: Record<FacetaLocalidade["papeis"][number], string> = {
  nascimento: "nascimento",
  batismo: "batismo",
  casamento: "casamento",
  emigracao: "emigração",
  chegada: "chegada",
}

export const PainelEstatisticas = memo(function PainelEstatisticas({
  aberto,
  facetas,
  qualidade,
  aoFechar,
  aoIrParaPessoa,
}: PainelEstatisticasProps) {
  const [aba, setAba] = useState<Aba>("sobrenomes")
  const [termo, setTermo] = useState("")
  const [soVariacao, setSoVariacao] = useState(false)

  const sobrenomes = useMemo(() => {
    const base = soVariacao ? facetas.sobrenomesComVariacao : facetas.sobrenomes
    return filtrarFacetas(base, termo)
  }, [facetas, termo, soVariacao])

  const localidades = useMemo(
    () => filtrarFacetas(facetas.localidades, termo),
    [facetas, termo],
  )

  if (!aberto) return null

  const lista = aba === "sobrenomes" ? sobrenomes : localidades

  return (
    <aside
      className="absolute right-0 top-0 z-20 flex h-full w-[320px] flex-col"
      style={{
        background: TREE.painel,
        borderLeft: `1px solid ${TREE.cartaoBorda}`,
        animation: `indiceEntrada 200ms ${EASE.rapido}`,
      }}
      role="complementary"
      aria-label="Estatísticas da árvore"
    >
      <style>{`
        @keyframes indiceEntrada {
          from { opacity: 0; transform: translateX(12px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <header className="px-4 pb-2 pt-3" style={{ borderBottom: `1px solid ${TREE.cartaoBorda}` }}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold" style={{ color: TREE.texto }}>
            Estatísticas da árvore
          </h2>
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar índice"
            className="rounded p-1 transition-colors arv-hover"
          >
            <X className="h-3.5 w-3.5" style={{ color: TREE.textoFraco }} />
          </button>
        </div>

        <dl className="mt-2 grid grid-cols-3 gap-1">
          <Numero rotulo="pessoas" valor={qualidade.totalPessoas} />
          <Numero rotulo="gerações" valor={qualidade.geracoesMapeadas} />
          <Numero rotulo="uniões" valor={qualidade.totalUnioes} />
        </dl>

        <nav className="mt-2 flex gap-0.5" role="tablist">
          {(["sobrenomes", "localidades"] as Aba[]).map((t) => {
            const ativo = aba === t
            const total = t === "sobrenomes" ? facetas.sobrenomes.length : facetas.localidades.length
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={ativo}
                onClick={() => setAba(t)}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors"
                style={{
                  background: ativo ? TREE.acentoSuave : "transparent",
                  color: ativo ? TREE.acentoTexto : TREE.textoFraco,
                }}
              >
                {t === "sobrenomes" ? <Users className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                {t}
                <span className="tabular-nums opacity-70">{total}</span>
              </button>
            )
          })}
        </nav>

        <label className="mt-2 flex items-center gap-1.5 rounded-md px-2 py-1" style={{ background: TREE.hover }}>
          <Search className="h-3 w-3 shrink-0" style={{ color: TREE.textoFraco }} />
          <input
            type="search"
            value={termo}
            onChange={(e) => setTermo(e.target.value)}
            placeholder={aba === "sobrenomes" ? "Filtrar sobrenome" : "Filtrar localidade"}
            aria-label={aba === "sobrenomes" ? "Filtrar sobrenome" : "Filtrar localidade"}
            className="w-full bg-transparent text-[12px] outline-none"
            style={{ color: TREE.texto }}
          />
        </label>

        {aba === "sobrenomes" && facetas.sobrenomesComVariacao.length > 0 && (
          <button
            type="button"
            aria-pressed={soVariacao}
            onClick={() => setSoVariacao((v) => !v)}
            className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium transition-colors"
            style={{
              border: `1px solid ${soVariacao ? SEVERIDADE_COR.medio : TREE.cartaoBorda}`,
              color: soVariacao ? SEVERIDADE_COR.medio : TREE.textoFraco,
              background: soVariacao ? `${SEVERIDADE_COR.medio}1A` : "transparent",
            }}
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            {facetas.sobrenomesComVariacao.length} com variação de grafia
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {lista.length === 0 && (
          <p className="px-2 py-6 text-center text-[11.5px]" style={{ color: TREE.textoFraco }}>
            Nada encontrado para “{termo}”.
          </p>
        )}

        {aba === "sobrenomes" &&
          sobrenomes.map((s) => (
            <ItemSobrenome key={s.chave} faceta={s} aoIrParaPessoa={aoIrParaPessoa} />
          ))}

        {aba === "localidades" &&
          localidades.map((l) => (
            <ItemLocalidade key={l.chave} faceta={l} aoIrParaPessoa={aoIrParaPessoa} />
          ))}
      </div>
    </aside>
  )
})

function ItemSobrenome({
  faceta,
  aoIrParaPessoa,
}: {
  faceta: FacetaSobrenome
  aoIrParaPessoa: (id: number) => void
}) {
  const periodo =
    faceta.anoDe != null && faceta.anoAte != null
      ? faceta.anoDe === faceta.anoAte
        ? String(faceta.anoDe)
        : `${faceta.anoDe}–${faceta.anoAte}`
      : null

  return (
    <button
      type="button"
      onClick={() => faceta.pessoaIds[0] != null && aoIrParaPessoa(faceta.pessoaIds[0])}
      className="mb-0.5 w-full rounded-lg px-2 py-1.5 text-left transition-colors arv-hover-suave"
    >
      <div className="flex items-baseline gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold" style={{ color: TREE.texto }}>
          {faceta.rotulo}
        </span>
        {faceta.naLinha > 0 && (
          <span
            className="shrink-0 rounded px-1 text-[9px] font-semibold"
            style={{ background: TREE.acentoSuave, color: TREE.acentoTexto }}
            title={`${faceta.naLinha} pessoa(s) na linha de cidadania`}
          >
            linha {faceta.naLinha}
          </span>
        )}
        <span className="shrink-0 text-[11px] tabular-nums" style={{ color: TREE.textoFraco }}>
          {faceta.total}
        </span>
      </div>

      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px]" style={{ color: TREE.textoSuave }}>
        {periodo && <span className="tabular-nums">{periodo}</span>}
        {faceta.variantes.length > 1 && (
          <span style={{ color: SEVERIDADE_COR.medio }} title="Grafias diferentes agrupadas pela fonética">
            {faceta.variantes.map((v) => v.grafia).join(" · ")}
          </span>
        )}
      </div>
    </button>
  )
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-md px-2 py-1" style={{ background: TREE.hover }}>
      <dd className="text-[15px] font-semibold tabular-nums" style={{ color: TREE.texto }}>
        {valor}
      </dd>
      <dt className="text-[10px]" style={{ color: TREE.textoSuave }}>
        {rotulo}
      </dt>
    </div>
  )
}

function ItemLocalidade({
  faceta,
  aoIrParaPessoa,
}: {
  faceta: FacetaLocalidade
  aoIrParaPessoa: (id: number) => void
}) {
  return (
    <button
      type="button"
      onClick={() => faceta.pessoaIds[0] != null && aoIrParaPessoa(faceta.pessoaIds[0])}
      className="mb-0.5 w-full rounded-lg px-2 py-1.5 text-left arv-hover-suave"
      title={`Ir para a primeira pessoa de ${faceta.rotulo}`}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium" style={{ color: TREE.texto }}>
          {faceta.rotulo}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums" style={{ color: TREE.textoFraco }}>
          {faceta.total}
        </span>
      </div>
      <div className="truncate text-[10px]" style={{ color: TREE.textoSuave }}>
        {faceta.pais ? `${faceta.pais} · ` : ""}
        {faceta.papeis.map((p) => ROTULO_PAPEL[p]).join(", ")}
      </div>
    </button>
  )
}
