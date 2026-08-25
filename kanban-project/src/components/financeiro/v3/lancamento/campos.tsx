// src/components/financeiro/v3/lancamento/campos.tsx
// ============================================================================
// Campos do lançamento financeiro — Design System, sem <select> nativo.
//
// `Campo` associa label, erro e dica ao input por id/aria (leitor de tela lê a
// mensagem junto do campo). `Selecao` é o substituto oficial do <select>: botão
// + popover navegável por teclado, com foco visível e ESC para fechar.
// `Origem` é a etiqueta que diz DE ONDE veio um valor preenchido sozinho — o
// operador nunca fica sem saber por que um campo já veio cheio.
// ============================================================================
"use client"

import { useEffect, useId, useRef, useState } from "react"
import { ChevronDown, Info } from "lucide-react"
import type { Problema } from "@/lib/financeiro/lancamento/calculo"

export const inputCls =
  "w-full rounded-[var(--radius-sm)] border bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"

export function Campo({
  label, children, problemas = [], dica, opcional, className, htmlFor,
}: {
  label: string
  children: (props: { id: string; descrevePor?: string; invalido: boolean }) => React.ReactNode
  problemas?: Problema[]
  dica?: React.ReactNode
  opcional?: boolean
  className?: string
  htmlFor?: string
}) {
  const auto = useId()
  const id = htmlFor ?? auto
  const msgId = `${id}-msg`
  const erros = problemas.filter((p) => p.severidade === "erro")
  const avisos = problemas.filter((p) => p.severidade === "aviso")
  const temMsg = erros.length > 0 || avisos.length > 0 || !!dica
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs text-[var(--text-secondary)]">
        {label}{opcional && <span className="text-[var(--text-muted)]"> (opcional)</span>}
      </label>
      <div className="mt-1">{children({ id, descrevePor: temMsg ? msgId : undefined, invalido: erros.length > 0 })}</div>
      {temMsg && (
        <div id={msgId} className="mt-1 space-y-0.5">
          {erros.map((p, i) => <p key={`e${i}`} className="text-[11px] text-[var(--danger)]">{p.mensagem}</p>)}
          {avisos.map((p, i) => <p key={`a${i}`} className="text-[11px] text-[var(--accent-text)]">{p.mensagem}</p>)}
          {dica && erros.length === 0 && <p className="text-[11px] text-[var(--text-muted)]">{dica}</p>}
        </div>
      )}
    </div>
  )
}

/** Etiqueta de procedência de um valor preenchido automaticamente. */
export function Origem({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
      <Info className="h-3 w-3" />{children}
    </span>
  )
}

export interface Opcao { valor: string; rotulo: string; detalhe?: string }

/** Substituto oficial do <select> nativo: acessível, navegável e com o visual do DS. */
export function Selecao({
  id, descrevePor, invalido, valor, opcoes, onChange, placeholder = "—", disabled,
}: {
  id?: string
  descrevePor?: string
  invalido?: boolean
  valor: string
  opcoes: Opcao[]
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [ativo, setAtivo] = useState(0)
  const caixa = useRef<HTMLDivElement>(null)
  const listaId = useId()
  const atual = opcoes.find((o) => o.valor === valor)

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false) }
    document.addEventListener("mousedown", fora)
    return () => document.removeEventListener("mousedown", fora)
  }, [aberto])

  /** Abre posicionando o cursor na opção atual — sem efeito, sem render em cascata. */
  const abrir = () => { setAtivo(Math.max(0, opcoes.findIndex((o) => o.valor === valor))); setAberto(true) }

  const teclado = (e: React.KeyboardEvent) => {
    if (!aberto && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) { e.preventDefault(); abrir(); return }
    if (!aberto) return
    if (e.key === "ArrowDown") { e.preventDefault(); setAtivo((a) => Math.min(a + 1, opcoes.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)) }
    else if (e.key === "Enter") { e.preventDefault(); const o = opcoes[ativo]; if (o) { onChange(o.valor); setAberto(false) } }
    else if (e.key === "Escape") { e.preventDefault(); setAberto(false) }
  }

  return (
    <div ref={caixa} className="relative">
      <button
        type="button" id={id} role="combobox" aria-expanded={aberto} aria-controls={listaId}
        aria-describedby={descrevePor} disabled={disabled}
        onClick={() => { if (disabled) return; aberto ? setAberto(false) : abrir() }} onKeyDown={teclado}
        className={`${inputCls} flex items-center justify-between gap-2 text-left disabled:opacity-60`}
        style={{ borderColor: invalido ? "var(--danger)" : "var(--border-default)" }}
      >
        <span className={atual ? "truncate text-[var(--text-primary)]" : "truncate text-[var(--text-muted)]"}>
          {atual?.rotulo ?? placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
      </button>
      {aberto && (
        <div id={listaId} role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-60 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-popover)] shadow-lg">
          {opcoes.length === 0 && <div className="px-3 py-3 text-xs text-[var(--text-muted)]">Nenhuma opção disponível.</div>}
          {opcoes.map((o, i) => (
            <div
              key={o.valor} role="option" aria-selected={o.valor === valor}
              onMouseEnter={() => setAtivo(i)}
              onClick={() => { onChange(o.valor); setAberto(false) }}
              className="cursor-pointer px-3 py-2 text-sm text-[var(--text-primary)]"
              style={{ background: i === ativo ? "var(--surface-hover)" : "transparent" }}
            >
              {o.rotulo}
              {o.detalhe && <span className="ml-2 text-[11px] text-[var(--text-muted)]">{o.detalhe}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Valor que o sistema definiu e a tela não deixa editar — mostrado, não escondido. */
export function ValorFixo({ children, origem }: { children: React.ReactNode; origem?: string }) {
  return (
    <div className={`${inputCls} flex items-center justify-between gap-2`} style={{ borderColor: "var(--border-default)" }}>
      <span className="truncate">{children}</span>
      {origem && <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{origem}</span>}
    </div>
  )
}

export function Secao({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4">
      <h4 className="text-sm font-medium text-[var(--text-primary)]">{titulo}</h4>
      {descricao && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{descricao}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}
