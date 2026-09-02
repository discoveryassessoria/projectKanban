"use client"

// src/components/ui/campo-data.tsx
//
// SELETOR DE DATA — mês e ano escolhidos direto, sem rodar mês a mês.
//
// ─── POR QUE ELE EXISTE ─────────────────────────────────────────────────────
// `<input type="date">` deixa o desenho por conta do navegador. No Safari isso
// vira um stepper: para chegar em 1945 você aperta a setinha oitenta vezes.
// Num sistema de genealogia, onde data de nascimento de bisavô é rotina, isso é
// inviável — e o formato exibido ainda muda conforme o idioma do navegador
// (mm/dd/yyyy num sistema em português).
//
// Aqui: dia num calendário clicável, mês e ano em seletores próprios. Ir de 2026
// para 1890 são dois cliques.
//
// ─── O VALOR CONTINUA SENDO ISO ─────────────────────────────────────────────
// Entra e sai "AAAA-MM-DD", igual ao input nativo. Quem usa não muda nada além
// de trocar o componente — e nenhuma data é reinterpretada no caminho.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"]

/** "AAAA-MM-DD" → partes. Sem `new Date`: ele desloca por fuso. */
function partes(iso: string | null | undefined) {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  return { ano: Number(m[1]), mes: Number(m[2]) - 1, dia: Number(m[3]) }
}
const paraIso = (ano: number, mes: number, dia: number) =>
  `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`

const exibir = (iso: string | null | undefined) => {
  const p = partes(iso)
  return p ? `${String(p.dia).padStart(2, "0")}/${String(p.mes + 1).padStart(2, "0")}/${p.ano}` : ""
}

const diasNoMes = (ano: number, mes: number) => new Date(ano, mes + 1, 0).getDate()
/** Dia da semana do 1º do mês (0 = domingo). Local, sem UTC. */
const primeiroDiaSemana = (ano: number, mes: number) => new Date(ano, mes, 1).getDay()

export interface CampoDataProps {
  value: string | null | undefined
  onChange: (iso: string | null) => void
  className?: string
  placeholder?: string
  /** Faixa de anos ofertada. Genealogia precisa de século XIX. */
  anoMinimo?: number
  anoMaximo?: number
  disabled?: boolean
  id?: string
  "aria-label"?: string
}

export function CampoData({
  value, onChange, className = "", placeholder = "dd/mm/aaaa",
  anoMinimo, anoMaximo, disabled = false, id, ...resto
}: CampoDataProps) {
  const [aberto, setAberto] = useState(false)
  const caixa = useRef<HTMLDivElement | null>(null)
  const hoje = new Date()

  const sel = partes(value)
  const [mesVisivel, setMesVisivel] = useState(sel?.mes ?? hoje.getMonth())
  const [anoVisivel, setAnoVisivel] = useState(sel?.ano ?? hoje.getFullYear())

  // Reabrir no mês da data escolhida — e não onde o usuário parou da última vez.
  useEffect(() => {
    if (!aberto) return
    const p = partes(value)
    if (p) { setMesVisivel(p.mes); setAnoVisivel(p.ano) }
  }, [aberto, value])

  const fechar = useCallback(() => setAberto(false), [])
  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) fechar()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fechar() }
    document.addEventListener("mousedown", fora)
    document.addEventListener("keydown", esc)
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc) }
  }, [aberto, fechar])

  // A faixa cobre o passado longo por padrão: certidão de 1890 é rotina aqui.
  const anos = useMemo(() => {
    const fim = anoMaximo ?? hoje.getFullYear() + 5
    const ini = anoMinimo ?? 1890
    const l: number[] = []
    for (let a = fim; a >= ini; a--) l.push(a)
    return l
  }, [anoMinimo, anoMaximo])

  const base =
    "w-full rounded-[10px] border border-[var(--border-default)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--action-primary)]"

  const total = diasNoMes(anoVisivel, mesVisivel)
  const vazios = primeiroDiaSemana(anoVisivel, mesVisivel)
  const ehHoje = (d: number) =>
    anoVisivel === hoje.getFullYear() && mesVisivel === hoje.getMonth() && d === hoje.getDate()
  const ehSelecionado = (d: number) => sel && sel.ano === anoVisivel && sel.mes === mesVisivel && sel.dia === d

  const passo = (delta: number) => {
    const m = mesVisivel + delta
    if (m < 0) { setMesVisivel(11); setAnoVisivel(anoVisivel - 1) }
    else if (m > 11) { setMesVisivel(0); setAnoVisivel(anoVisivel + 1) }
    else setMesVisivel(m)
  }

  return (
    <div ref={caixa} className="relative">
      <button
        type="button" id={id} disabled={disabled}
        onClick={() => setAberto((v) => !v)}
        className={`${className || base} flex items-center justify-between gap-2 text-left disabled:opacity-50`}
        {...resto}
      >
        <span className={value ? "" : "text-[var(--text-muted)]"}>{exibir(value) || placeholder}</span>
        <span className="flex shrink-0 items-center gap-1">
          {value && !disabled && (
            <span
              role="button" tabIndex={0} aria-label="Limpar data"
              onClick={(e) => { e.stopPropagation(); onChange(null) }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onChange(null) } }}
              className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >×</span>
          )}
          <span aria-hidden className="text-[var(--text-muted)]">▾</span>
        </span>
      </button>

      {aberto && !disabled && (
        <div className="absolute z-40 mt-1 w-[17rem] rounded-[12px] border border-[var(--border-default)] bg-[var(--surface-elevated)] p-2.5 shadow-lg">
          {/* MÊS E ANO SÃO SELETORES, não setas. É o ponto todo do componente. */}
          <div className="mb-2 flex items-center gap-1.5">
            <button type="button" onClick={() => passo(-1)} aria-label="Mês anterior"
              className="rounded-[8px] px-1.5 py-1 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]">‹</button>
            <select
              value={mesVisivel} onChange={(e) => setMesVisivel(Number(e.target.value))} aria-label="Mês"
              className="flex-1 rounded-[8px] border border-[var(--border-subtle)] bg-transparent px-1.5 py-1 text-[13px] text-[var(--text-primary)] outline-none"
            >
              {MESES.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            <select
              value={anoVisivel} onChange={(e) => setAnoVisivel(Number(e.target.value))} aria-label="Ano"
              className="w-[5.2rem] rounded-[8px] border border-[var(--border-subtle)] bg-transparent px-1.5 py-1 text-[13px] text-[var(--text-primary)] outline-none"
            >
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <button type="button" onClick={() => passo(1)} aria-label="Próximo mês"
              className="rounded-[8px] px-1.5 py-1 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]">›</button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center">
            {DIAS_SEMANA.map((d, i) => (
              <span key={i} className="py-0.5 text-[10px] font-medium uppercase text-[var(--text-muted)]">{d}</span>
            ))}
            {Array.from({ length: vazios }).map((_, i) => <span key={`v${i}`} />)}
            {Array.from({ length: total }).map((_, i) => {
              const d = i + 1
              const sim = ehSelecionado(d)
              return (
                <button
                  key={d} type="button"
                  onClick={() => { onChange(paraIso(anoVisivel, mesVisivel, d)); setAberto(false) }}
                  className={`rounded-[7px] py-1 text-[12.5px] ${
                    sim ? "bg-[var(--action-primary)] font-medium text-[var(--text-inverse)]"
                    : ehHoje(d) ? "border border-[var(--action-primary)] text-[var(--text-primary)]"
                    : "text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]"}`}
                >{d}</button>
              )
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2">
            <button type="button"
              onClick={() => { const h = new Date(); onChange(paraIso(h.getFullYear(), h.getMonth(), h.getDate())); setAberto(false) }}
              className="text-[12px] text-[var(--action-primary)] hover:underline">Hoje</button>
            <button type="button" onClick={() => { onChange(null); setAberto(false) }}
              className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">Limpar</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default CampoData
