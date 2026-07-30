// src/components/arvore/motor/paleta-comandos.tsx
//
// LOCALIZAR NA ÁRVORE (⌘K / Ctrl+K, ou "/").
//
// É a busca de pessoa da experiência de referência, não uma paleta de comandos.
// A diferença importa: paleta de comandos abre listando TUDO que o sistema sabe
// fazer — padrão de ferramenta de desenvolvedor, que faz a tela parecer um
// editor. Aqui, abrir mostra um campo vazio esperando um nome, e é só isso.
//
// O operador digita o que lembra — nome torto, cidade, ano, navio, cartório — e
// a árvore voa até a pessoa. Ir de "lembrei de alguém" a "estou olhando para
// ela" custa duas teclas e nenhuma troca de contexto.
//
// Ações de visualização continuam alcançáveis por aqui, mas SÓ quando o texto
// digitado casa com elas: elas nunca ocupam a tela por conta própria.

"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Search, CornerDownLeft, Command as CommandIcon } from "lucide-react"
import { buscar, type ItemIndice, type ResultadoBusca } from "@/src/lib/genealogia/motor/busca"
import { EASE, TREE } from "./tokens"

export interface ComandoPaleta {
  id: string
  rotulo: string
  descricao?: string
  atalho?: string
  icone?: React.ReactNode
  executar: () => void
}

export interface PaletaComandosProps {
  aberta: boolean
  aoFechar: () => void
  indice: ItemIndice[]
  comandos: ComandoPaleta[]
  aoEscolherPessoa: (pessoaId: number) => void
}

/**
 * A paleta só é MONTADA quando aberta. Isso não é detalhe de performance: é o
 * que dispensa qualquer "resetar estado ao abrir" dentro de efeito — o estado
 * nasce limpo porque o componente nasce junto. Menos efeito, menos render em
 * cascata, menos chance de abrir com o texto da busca anterior.
 */
export function PaletaComandos(props: PaletaComandosProps) {
  if (!props.aberta) return null
  return <PaletaInterna {...props} />
}

function PaletaInterna({
  aoFechar,
  indice,
  comandos,
  aoEscolherPessoa,
}: PaletaComandosProps) {
  const [termo, setTermo] = useState("")
  const [ativoBruto, setAtivo] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // foco no próximo quadro: o input ainda não existe no mesmo tick
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  const pessoas: ResultadoBusca[] = useMemo(
    () => (termo.trim() ? buscar(indice, termo, 8) : []),
    [indice, termo],
  )

  // Sem texto, NENHUM comando é listado — a tela de "Localizar" abre para
  // procurar pessoa, não para exibir um menu de funções.
  const comandosFiltrados = useMemo(() => {
    const t = termo.trim().toLowerCase()
    if (!t) return []
    return comandos.filter(
      (c) => c.rotulo.toLowerCase().includes(t) || c.descricao?.toLowerCase().includes(t),
    )
  }, [comandos, termo])

  const itens = useMemo(
    () => [
      ...pessoas.map((p) => ({ tipo: "pessoa" as const, chave: `p-${p.pessoaId}`, dado: p })),
      ...comandosFiltrados.map((c) => ({ tipo: "comando" as const, chave: `c-${c.id}`, dado: c })),
    ],
    [pessoas, comandosFiltrados],
  )

  // Clamp derivado em vez de corrigido por efeito: o índice sempre existe,
  // mesmo no quadro em que a lista encolhe.
  const ativo = Math.min(ativoBruto, Math.max(0, itens.length - 1))

  // rolagem acompanha a seleção por teclado
  useEffect(() => {
    const el = listaRef.current?.querySelector<HTMLElement>(`[data-idx="${ativo}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [ativo])

  const executar = (idx: number) => {
    const item = itens[idx]
    if (!item) return
    if (item.tipo === "pessoa") aoEscolherPessoa(item.dado.pessoaId)
    else item.dado.executar()
    aoFechar()
  }

  return (
    <div
      data-arvore-overlay
      className="fixed inset-0 z-[10050] flex items-start justify-center pt-[12vh]"
      onClick={aoFechar}
      role="dialog"
      aria-modal="true"
      aria-label="Localizar pessoa na árvore"
    >
      <div
        className="absolute inset-0"
        style={{ background: TREE.veu, backdropFilter: "blur(2px)" }}
      />
      <div
        data-no-pan
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[560px] overflow-hidden rounded-2xl shadow-2xl"
        style={{
          background: TREE.popover,
          border: `1px solid ${TREE.cartaoBorda}`,
          animation: `paletaEntrada 220ms ${EASE.suave}`,
        }}
      >
        <style>{`
          @keyframes paletaEntrada {
            from { opacity: 0; transform: translateY(-10px) scale(0.985); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
          }
        `}</style>

        <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: `1px solid ${TREE.cartaoBorda}` }}>
          <Search className="h-4 w-4 shrink-0" style={{ color: TREE.textoFraco }} />
          <input
            ref={inputRef}
            value={termo}
            onChange={(e) => {
              setTermo(e.target.value)
              setAtivo(0)
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setAtivo((a) => Math.min(a + 1, itens.length - 1))
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                setAtivo((a) => Math.max(a - 1, 0))
              } else if (e.key === "Enter") {
                e.preventDefault()
                executar(ativo)
              } else if (e.key === "Escape") {
                e.preventDefault()
                aoFechar()
              }
            }}
            placeholder="Localizar pessoa: nome, cidade, ano, cartório, navio…"
            className="w-full bg-transparent text-[14px] outline-none"
            style={{ color: TREE.texto }}
            aria-label="Localizar pessoa na árvore"
            aria-autocomplete="list"
          />
          <kbd
            className="hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] sm:block"
            style={{ background: TREE.hover, color: TREE.textoFraco }}
          >
            esc
          </kbd>
        </div>

        <div ref={listaRef} className="max-h-[52vh] overflow-y-auto py-1.5" role="listbox">
          {itens.length === 0 && (
            <p className="px-4 py-6 text-center text-[13px]" style={{ color: TREE.textoFraco }}>
              {termo ? `Nada encontrado para “${termo}”.` : "Digite o nome de quem você procura."}
            </p>
          )}

          {pessoas.length > 0 && (
            <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: TREE.textoFraco }}>
              Pessoas
            </p>
          )}

          {itens.map((item, idx) => {
            const selecionado = idx === ativo
            if (item.tipo === "pessoa") {
              const p = item.dado
              return (
                <button
                  key={item.chave}
                  data-idx={idx}
                  type="button"
                  role="option"
                  aria-selected={selecionado}
                  onMouseEnter={() => setAtivo(idx)}
                  onClick={() => executar(idx)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left"
                  style={{ background: selecionado ? TREE.acentoSuave : "transparent" }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13.5px] font-medium" style={{ color: TREE.texto }}>
                        {p.nome}
                      </span>
                      {p.naLinha && (
                        <span
                          className="shrink-0 rounded px-1 py-[1px] text-[9px] font-semibold"
                          style={{ background: TREE.acentoSuave, color: TREE.acentoTexto }}
                        >
                          linha
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px]" style={{ color: TREE.textoFraco }}>
                      {p.motivo || p.subtitulo}
                    </span>
                  </span>
                  {selecionado && <CornerDownLeft className="h-3.5 w-3.5 shrink-0" style={{ color: TREE.textoFraco }} />}
                </button>
              )
            }

            const c = item.dado
            const primeiroComando = idx === pessoas.length
            return (
              <div key={item.chave}>
                {primeiroComando && (
                  <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: TREE.textoFraco }}>
                    Ações
                  </p>
                )}
                <button
                  data-idx={idx}
                  type="button"
                  role="option"
                  aria-selected={selecionado}
                  onMouseEnter={() => setAtivo(idx)}
                  onClick={() => executar(idx)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left"
                  style={{ background: selecionado ? TREE.acentoSuave : "transparent" }}
                >
                  <span className="shrink-0" style={{ color: TREE.textoFraco }}>
                    {c.icone ?? <CommandIcon className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px]" style={{ color: TREE.texto }}>
                      {c.rotulo}
                    </span>
                    {c.descricao && (
                      <span className="block truncate text-[11px]" style={{ color: TREE.textoFraco }}>
                        {c.descricao}
                      </span>
                    )}
                  </span>
                  {c.atalho && (
                    <kbd
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                      style={{ background: TREE.hover, color: TREE.textoFraco }}
                    >
                      {c.atalho}
                    </kbd>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
