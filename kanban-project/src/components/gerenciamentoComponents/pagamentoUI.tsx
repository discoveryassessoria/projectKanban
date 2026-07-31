'use client'
// ============================================================================
// Primitivos premium compartilhados dos cadastros de pagamento (identidade
// Financeiro: dark glass + OURO). Usados por Taxa e Condição de Pagamento —
// "shell compartilhado" da arquitetura. Sem lógica de domínio aqui.
// ============================================================================
import * as React from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, X } from 'lucide-react'

export const OURO = '#D2A948'
export const GLASS = 'rounded-xl border border-white/10 bg-white/[0.05] backdrop-blur-md'
export const INPUT = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30'

export async function jf(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const res = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error || `Erro ${res.status}`)
  return data
}

export function toggleArr<T>(arr: T[], v: T): T[] { return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v] }

export function Secao({ icon: Ic, titulo, dica, children }: { icon?: any; titulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <div className={`${GLASS} p-4`}>
      <div className="mb-1 flex items-center gap-2">{Ic && <Ic className="h-4 w-4" style={{ color: OURO }} />}<h4 className="text-sm font-semibold text-white">{titulo}</h4></div>
      {dica && <p className="mb-3 text-[11px] text-white/40">{dica}</p>}
      <div className={dica ? '' : 'mt-2'}>{children}</div>
    </div>
  )
}

export function Campo({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <div className={wide ? 'sm:col-span-2' : ''}><label className="mb-1 block text-xs text-white/60">{label}</label>{children}</div>
}

export function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
      {options.map(([v, l]) => <option key={v} value={v} className="bg-zinc-900">{l}</option>)}
    </select>
  )
}

export function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="flex items-center gap-2 text-left text-sm text-white/80">
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? '' : 'bg-white/15'}`} style={on ? { background: OURO } : undefined}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  )
}

export function ChipsMulti({ items, selecionados, onToggle }: { items: { id: string | number; label: string }[]; selecionados: (string | number)[]; onToggle: (id: string | number) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const on = selecionados.includes(it.id)
        return (
          <button key={String(it.id)} type="button" onClick={() => onToggle(it.id)} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition ${on ? 'text-[#1b1508]' : 'border-white/15 text-white/60 hover:text-white'}`} style={on ? { background: OURO, borderColor: OURO } : undefined}>
            {on && <Check className="h-3 w-3" />}{it.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Seleção múltipla APENAS SELECIONÁVEL ────────────────────────────────────
// Contrato desta primitiva (é o que as etapas de Aplicabilidade exigem):
//   • o VALOR nunca é digitado — só se escolhe entre opções do cadastro real
//     (o filtro opcional `busca` filtra a lista; não cria nem converte valor);
//   • valor selecionado vira chip removível;
//   • não duplica (a lista é um conjunto por construção);
//   • fecha ao clicar fora e no Escape; um seletor aberto fecha os outros;
//   • navegável por teclado (setas, Enter/Espaço, Home/End, Escape);
//   • vazio = sem restrição (a semântica é do chamador; aqui é só o `dicaVazio`).
//
// POR QUE PORTAL (causa do travamento anterior):
//   o menu era `position:absolute` DENTRO do card e do modal — ambos com
//   overflow — então era CORTADO pelo card e sobrepunha o bloco seguinte. Agora
//   o menu é renderizado em portal no <body> com `position:fixed`, medido a
//   partir do campo: abre abaixo, ou ACIMA quando não há espaço, sempre dentro
//   da viewport, com scroll interno. Sem backdrop de tela inteira (era o que
//   deixava overlay invisível capturando cliques) e desmontado ao fechar.
export interface OpcaoMulti { id: number; label: string; hint?: string }

// Registro de instâncias abertas: garante UM seletor aberto por vez e permite
// que o wizard feche tudo ao trocar de etapa / fechar o modal (sem estado preso).
const abertos = new Set<() => void>()
export function fecharTodosMultiSelects() {
  for (const fechar of Array.from(abertos)) fechar()
  abertos.clear()
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

interface PosMenu { left: number; top: number; width: number; maxH: number; acima: boolean }

/**
 * Opção ESPECIAL fixada no topo da lista (opt-in). Serve para um valor que não é
 * um registro do cadastro — tipicamente "Todas", que significa aplicação global.
 *
 * O componente NÃO conhece a regra: ele só desenha o estado e avisa o clique.
 * Quem decide o que "Todas" faz com a seleção individual é o dono do formulário,
 * pela sua fonte única pura — aqui não existe segunda cópia da regra.
 */
export interface OpcaoEspecial {
  label: string
  /** Ligada? Quando ligada, as opções individuais aparecem apagadas. */
  ativa: boolean
  /** Clique na opção (na lista ou no "x" do chip). */
  onToggle: () => void
  hint?: string
}

export function MultiSelect({
  opcoes, selecionados, onChange, placeholder = 'Selecionar…', dicaVazio, vazioMsg = 'Nenhum registro cadastrado.', id,
  busca = false, acoes = false, buscaPlaceholder = 'Filtrar…', especial,
}: {
  opcoes: OpcaoMulti[]
  selecionados: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
  dicaVazio?: string
  vazioMsg?: string
  id?: string
  /** Filtro da LISTA (opt-in). Nunca cria valor: só reduz as opções exibidas. */
  busca?: boolean
  /** Botões "Selecionar todas" / "Limpar seleção" (opt-in). */
  acoes?: boolean
  buscaPlaceholder?: string
  /** Opção especial fixada no topo (ex.: "Todas" = aplicação global). */
  especial?: OpcaoEspecial
}) {
  const [aberto, setAberto] = React.useState(false)
  const [foco, setFoco] = React.useState(0)
  const [filtro, setFiltro] = React.useState('')
  const [pos, setPos] = React.useState<PosMenu | null>(null)
  const raiz = React.useRef<HTMLDivElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const listaRef = React.useRef<HTMLUListElement>(null)
  const buscaRef = React.useRef<HTMLInputElement>(null)
  // id da lista: o combobox precisa apontar para ela (aria-controls).
  const idLista = `${React.useId()}-lista`

  const porId = React.useMemo(() => new Map(opcoes.map((o) => [o.id, o])), [opcoes])
  // Só ids que existem no cadastro chegam a ser exibidos como chip.
  const escolhidos = React.useMemo(
    () => selecionados.filter((sid) => porId.has(sid)).map((sid) => porId.get(sid)!),
    [selecionados, porId],
  )
  const visiveis = React.useMemo(() => {
    const q = semAcento(filtro.trim())
    if (!busca || !q) return opcoes
    return opcoes.filter((o) => semAcento(o.label).includes(q) || semAcento(o.hint ?? '').includes(q))
  }, [opcoes, filtro, busca])

  // Estável (deps []): pode ser usada direto nos efeitos, sem ref intermediária —
  // escrever em ref durante o render não é permitido e aqui era desnecessário.
  const fechar = React.useCallback(() => { setAberto(false); setFiltro('') }, [])

  const abrir = React.useCallback(() => {
    fecharTodosMultiSelects() // só um seletor aberto por vez
    setFoco(0)
    setAberto(true)
  }, [])

  // Medição: posiciona o menu em coordenadas de viewport (position: fixed).
  const medir = React.useCallback(() => {
    const r = raiz.current?.getBoundingClientRect()
    if (!r || typeof window === 'undefined') return
    const margem = 8
    const espacoAbaixo = window.innerHeight - r.bottom - margem
    const espacoAcima = r.top - margem
    const acima = espacoAbaixo < 240 && espacoAcima > espacoAbaixo
    const maxH = Math.max(140, Math.min(320, acima ? espacoAcima : espacoAbaixo))
    const width = Math.min(Math.max(r.width, 220), window.innerWidth - margem * 2)
    let left = r.left
    if (left + width > window.innerWidth - margem) left = window.innerWidth - margem - width
    if (left < margem) left = margem
    setPos({ left, top: acima ? Math.max(margem, r.top - maxH - 4) : r.bottom + 4, width, maxH, acima })
  }, [])

  // Enquanto aberto: registra a instância, mede, reposiciona em scroll/resize e
  // fecha ao clicar fora / Escape. TUDO é removido no cleanup (sem listener órfão).
  React.useLayoutEffect(() => {
    if (!aberto) return
    const fechaEsta = () => fechar()
    abertos.add(fechaEsta)
    medir()

    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (raiz.current?.contains(alvo)) return
      if (menuRef.current?.contains(alvo)) return
      fechar()
    }
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar() }
    const reposicionar = () => medir()

    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', tecla)
    window.addEventListener('resize', reposicionar)
    window.addEventListener('scroll', reposicionar, true) // captura: pega os scrollers internos
    return () => {
      abertos.delete(fechaEsta)
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', tecla)
      window.removeEventListener('resize', reposicionar)
      window.removeEventListener('scroll', reposicionar, true)
      setPos(null) // ao fechar/desmontar, a medição do menu deixa de valer
    }
  }, [aberto, medir, fechar])

  // Cleanup no unmount: nada fica registrado se o wizard for desmontado aberto.
  React.useEffect(() => () => { abertos.delete(fechar) }, [fechar])

  React.useEffect(() => {
    if (!aberto || !listaRef.current) return
    listaRef.current.querySelector<HTMLElement>(`[data-i="${foco}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [foco, aberto])

  // Alterna: já selecionado sai, senão entra. Nunca duplica.
  const alternar = (oid: number) => {
    onChange(selecionados.includes(oid) ? selecionados.filter((x) => x !== oid) : [...selecionados, oid])
  }

  const teclado = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { fechar(); return }
    if (!aberto && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) { e.preventDefault(); abrir(); return }
    if (!aberto || visiveis.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setFoco((f) => (f + 1) % visiveis.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFoco((f) => (f - 1 + visiveis.length) % visiveis.length) }
    else if (e.key === 'Home') { e.preventDefault(); setFoco(0) }
    else if (e.key === 'End') { e.preventDefault(); setFoco(visiveis.length - 1) }
    else if (e.key === 'Enter' || (e.key === ' ' && e.target !== buscaRef.current)) { e.preventDefault(); const o = visiveis[foco]; if (o) alternar(o.id) }
  }

  const menu = aberto && pos && typeof document !== 'undefined' ? createPortal(
    <div
      ref={menuRef}
      // z acima do modal (z-50/z-[60]); sem backdrop — nada cobre a página.
      style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxH, zIndex: 120 }}
      className="flex flex-col overflow-hidden rounded-lg border border-white/15 bg-zinc-900 shadow-2xl"
      onKeyDown={teclado}
    >
      {busca && (
        <div className="shrink-0 border-b border-white/10 p-1.5">
          <input
            ref={buscaRef} value={filtro} onChange={(e) => { setFiltro(e.target.value); setFoco(0) }}
            placeholder={buscaPlaceholder} autoFocus
            className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/25"
          />
        </div>
      )}
      {acoes && (
        <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-2 py-1.5 text-[11px]">
          <button type="button" onClick={() => onChange(Array.from(new Set([...selecionados, ...visiveis.map((o) => o.id)])))} className="text-white/60 transition hover:text-white">Selecionar todas</button>
          <span className="text-white/20">·</span>
          <button type="button" onClick={() => onChange([])} className="text-white/60 transition hover:text-white">Limpar seleção</button>
        </div>
      )}
      {especial && (
        // FIXADA no topo: não some com o filtro da busca, porque não é um
        // registro do cadastro — é o modo de aplicação do item.
        <div className="shrink-0 border-b border-white/10 p-1">
          <button
            type="button" role="option" aria-selected={especial.ativa} onClick={especial.onToggle}
            className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-white/10 ${especial.ativa ? 'text-white' : 'text-white/70'}`}
          >
            <span className="grid h-4 w-4 shrink-0 place-items-center rounded border" style={especial.ativa ? { background: OURO, borderColor: OURO } : { borderColor: 'rgba(255,255,255,0.25)' }}>
              {especial.ativa && <Check className="h-3 w-3 text-[#1b1508]" />}
            </span>
            <span className="truncate font-medium">{especial.label}</span>
            {especial.hint && <span className="ml-auto shrink-0 text-[10px] text-white/35">{especial.hint}</span>}
          </button>
        </div>
      )}
      <ul ref={listaRef} id={idLista} role="listbox" aria-multiselectable tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto p-1">
        {opcoes.length === 0 ? (
          <li className="px-2 py-2 text-[11px] text-white/35">{vazioMsg}</li>
        ) : visiveis.length === 0 ? (
          <li className="px-2 py-2 text-[11px] text-white/35">Nada encontrado.</li>
        ) : visiveis.map((o, i) => {
          const on = selecionados.includes(o.id)
          return (
            <li key={o.id} data-i={i} role="option" aria-selected={on}
              onMouseEnter={() => setFoco(i)} onClick={() => alternar(o.id)}
              // Com a opção especial ligada, as individuais ficam apagadas — mas
              // continuam CLICÁVEIS: clicar em uma é justamente como se sai do
              // modo especial (quem trata isso é o `onChange` do formulário).
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition ${foco === i ? 'bg-white/10' : ''} ${on ? 'text-white' : 'text-white/70'} ${especial?.ativa ? 'opacity-45' : ''}`}
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded border" style={on ? { background: OURO, borderColor: OURO } : { borderColor: 'rgba(255,255,255,0.25)' }}>
                {on && <Check className="h-3 w-3 text-[#1b1508]" />}
              </span>
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="ml-auto shrink-0 text-[10px] text-white/35">{o.hint}</span>}
            </li>
          )
        })}
      </ul>
    </div>,
    document.body,
  ) : null

  return (
    <div ref={raiz} className="relative">
      <button
        type="button" id={id} role="combobox" aria-expanded={aberto} aria-haspopup="listbox" aria-controls={idLista}
        onClick={() => (aberto ? fechar() : abrir())} onKeyDown={teclado}
        className={`${INPUT} flex items-center justify-between gap-2 text-left`}
      >
        <span className={especial?.ativa || escolhidos.length ? 'text-white/85' : 'text-white/30'}>
          {especial?.ativa
            ? especial.label
            : escolhidos.length ? `${escolhidos.length} selecionado${escolhidos.length > 1 ? 's' : ''}` : placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-white/40 transition ${aberto ? 'rotate-180' : ''}`} />
      </button>

      {menu}

      {/* A opção especial ocupa o lugar dos chips: ligada, ela É a seleção. */}
      {especial?.ativa ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs" style={{ background: `${OURO}1f`, borderColor: `${OURO}55`, color: OURO }}>
            {especial.label}
            <button type="button" aria-label={`Remover ${especial.label}`} onClick={especial.onToggle} className="opacity-70 transition hover:opacity-100">
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      ) : escolhidos.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {escolhidos.map((o) => (
            <span key={o.id} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs" style={{ background: `${OURO}1f`, borderColor: `${OURO}55`, color: OURO }}>
              {o.label}
              <button type="button" aria-label={`Remover ${o.label}`} onClick={() => alternar(o.id)} className="opacity-70 transition hover:opacity-100">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : dicaVazio ? (
        <p className="mt-1 text-[11px] text-white/35">{dicaVazio}</p>
      ) : null}
    </div>
  )
}

/** Casca do wizard: header fixo, corpo rolável, footer fixo. Sem overflow que
 *  corte menus (os dropdowns saem em portal) e sem depender do scroll do body. */
export function ModalWizard({ onClose, largura = 'max-w-2xl', header, footer, children }: {
  onClose: () => void
  largura?: string
  header: React.ReactNode
  footer: React.ReactNode
  children: React.ReactNode
}) {
  React.useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && !abertos.size) onClose() }
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('keydown', tecla); fecharTodosMultiSelects() }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => { fecharTodosMultiSelects(); onClose() }}>
      <div
        className={`flex max-h-[90vh] w-full ${largura} flex-col rounded-2xl border border-white/10 bg-zinc-900/95 text-white shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 rounded-t-2xl border-b border-white/10 bg-zinc-900/95 px-6 py-4">{header}</div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">{children}</div>
        <div className="shrink-0 rounded-b-2xl border-t border-white/10 bg-zinc-900/95 px-6 py-4">{footer}</div>
      </div>
    </div>
  )
}

/** Trilha de passos (stepper) premium. */
export function Stepper({ passos, atual }: { passos: string[]; atual: number }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {passos.map((label, i) => {
        const n = i + 1
        return (
          <div key={label} className={`flex items-center gap-1.5 text-xs ${atual === n ? 'text-white' : atual > n ? 'text-emerald-400' : 'text-white/35'}`}>
            <span className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${atual === n ? 'border-white/40' : atual > n ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-white/15'}`}>{atual > n ? <Check className="h-3 w-3" /> : n}</span>
            {label}
          </div>
        )
      })}
    </div>
  )
}
