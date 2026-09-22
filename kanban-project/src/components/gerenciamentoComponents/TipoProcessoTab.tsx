'use client'

// ESTE ARQUIVO SUBSTITUI: src/components/gerenciamentoComponents/TipoProcessoTab.tsx
//
// "Reconstrução da hierarquia País/Região → Tipo de Processo → Modalidade →
// Workflow Macro" (22/09/2026): Modalidade virou ENUMERAÇÃO CANÔNICA
// (administrativa | judicial, sem texto livre) com tela própria dedicada
// (ModalidadesTab, Processos › Cadastros › Modalidades). O modal "Gerenciar
// modalidades" que existia aqui foi REMOVIDO — ele deixaria de funcionar de
// qualquer forma, já que o backend agora recusa POST/PUT com label livre. O
// botão vira link para a tela dedicada, mesmo padrão já usado noutras telas
// deste módulo (ver MacroKanbanTab "A fase que preciso não está na lista").
//
// Também mudou a cardinalidade Tipo↔Modalidade: um Tipo pode habilitar
// Administrativa, Judicial ou AMBAS (`TipoProcessoModalidadeHabilitada`,
// N:N real) — não mais uma única modalidade fixa. O formulário de criação
// usa checkboxes (mesmo padrão de PaisesRegioesTab), e a listagem mostra
// todas as modalidades habilitadas por tipo.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useApi } from "@/src/lib/dados"

type Pais = {
  id: number; countryKey: string; countryLabel: string
  nationalityKey: string; nationalityLabel: string
  flag: string | null; codePrefix: string | null
  defaultCurrency?: string; ativo?: boolean
  tiposCount?: number
}
type ModalidadeHabilitada = { id: number; modalityKey: string; modalityLabel: string; temWorkflowMacro: boolean }
type Tipo = {
  id: number; code: string; name: string
  countryKey: string; countryLabel: string; nationalityLabel: string
  modalidades: ModalidadeHabilitada[]
  ativo: boolean
}

async function jsonFetch(url: string, options: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as any)?.error || `Erro ${res.status}`)
  return data
}

// Identidade estável para a ausência de dados (evita recomputar memos).
const SEM_ITENS: never[] = Object.freeze([]) as never[]

export default function TipoProcessoTab() {
  const [busca, setBusca] = useState('')

  const [modalAberto, setModalAberto] = useState(false)
  const [editando, setEditando] = useState<Tipo | null>(null)
  const [countryKey, setCountryKey] = useState('')
  // Um Tipo pode habilitar Administrativa, Judicial ou ambas — só na
  // criação (o PUT de edição não aceita mudar modalidade habilitada, isso
  // é gerido por /[id]/modalidades, fora do escopo desta tela).
  const [modalidadesSel, setModalidadesSel] = useState<Set<string>>(new Set())
  // Código e nome são SUGESTÃO com direito de sobrescrever. Antes dois efeitos
  // copiavam a sugestão para o estado; o campo ficava um render atrás da escolha de
  // país/modalidade — dava para ver a sugestão velha depois de trocar o país.
  // Agora o estado guarda só o que foi DIGITADO, e o campo é derivado.
  const [codeDigitado, setCode] = useState('')
  const [nameDigitado, setName] = useState('')
  const [ativo, setAtivo] = useState(true)
  const [codeTouched, setCodeTouched] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState<string | null>(null)

  // ===== Gerenciar países =====
  const [paisesModal, setPaisesModal] = useState(false)
  const [paisesAdmin, setPaisesAdmin] = useState<Pais[]>([])
  const [carregandoPaises, setCarregandoPaises] = useState(false)
  const [visao, setVisao] = useState<'lista' | 'form'>('lista')
  const [editandoPais, setEditandoPais] = useState<Pais | null>(null) // null = criando
  const [pLabel, setPLabel] = useState('')
  const [pFlag, setPFlag] = useState('')
  const [pNat, setPNat] = useState('')
  const [pPrefix, setPPrefix] = useState('')
  const [pMoeda, setPMoeda] = useState('EUR')
  const [pJud, setPJud] = useState(true)
  const [pAdm, setPAdm] = useState(true)
  const [salvandoPais, setSalvandoPais] = useState(false)
  const [erroPais, setErroPais] = useState<string | null>(null)

  // UMA consulta, várias listas derivadas da MESMA resposta — o endpoint já
  // devolve tudo junto. loading/erro vêm da camada; nada de setState em efeito.
  const { dados, carregando: loading, erro, recarregar: carregar } = useApi<{ tipos?: Tipo[], paises?: any[], modalidades?: any[] }>('/api/gerenciamento/tipos-processo')
  const itens: Tipo[] = dados?.tipos ?? SEM_ITENS
  const paises: any[] = dados?.paises ?? SEM_ITENS
  const modalidades: any[] = dados?.modalidades ?? SEM_ITENS
  const erroLista = erro ? (erro.message || 'Não foi possível carregar os tipos de processo.') : null

  const carregarPaisesAdmin = useCallback(async () => {
    setCarregandoPaises(true)
    try {
      const d = await jsonFetch('/api/gerenciamento/paises', { cache: 'no-store' })
      setPaisesAdmin((d as any).paises || [])
    } catch (e: any) {
      setErroPais(e.message || 'Não foi possível carregar os países.')
    } finally { setCarregandoPaises(false) }
  }, [])

  const paisSel = useMemo(() => paises.find((p) => p.countryKey === countryKey) || null, [paises, countryKey])
  const modsDoPais = useMemo(() => modalidades.filter((m) => m.countryKey === countryKey), [modalidades, countryKey])
  // dropdown de "Novo processo" só mostra ativas (inativa some, sem apagar)
  const modsAtivasDoPais = useMemo(() => modsDoPais.filter((m) => m.ativo !== false), [modsDoPais])
  const modsSelecionadas = useMemo(() => modsAtivasDoPais.filter((m) => modalidadesSel.has(m.modalityKey)), [modsAtivasDoPais, modalidadesSel])

  // sugestões automáticas de código e nome — junta prefixo do país com o(s)
  // sufixo(s) de TODAS as modalidades escolhidas (ex.: ITA-JUD-ADM).
  const sugCode = useMemo(() => {
    if (!paisSel || modsSelecionadas.length === 0) return ''
    const pre = paisSel.codePrefix || paisSel.countryKey.slice(0, 3).toUpperCase()
    const sufs = modsSelecionadas.map((m) => m.codeSuffix || m.modalityKey.slice(0, 4).toUpperCase())
    return `${pre}-${sufs.join('-')}`
  }, [paisSel, modsSelecionadas])
  const sugName = useMemo(() => {
    if (!paisSel || modsSelecionadas.length === 0) return ''
    return `Nacionalidade ${paisSel.nationalityLabel} · ${modsSelecionadas.map((m) => m.modalityLabel).join(' + ')}`
  }, [paisSel, modsSelecionadas])

  // Enquanto o usuário não mexeu, vale a sugestão; depois de mexer, vale o dele.
  const code = codeTouched ? codeDigitado : sugCode
  const name = nameTouched ? nameDigitado : sugName

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return itens
    return itens.filter((t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q) || t.countryLabel.toLowerCase().includes(q))
  }, [itens, busca])

  function toggleModalidadeSel(key: string) {
    setModalidadesSel((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  function abrirNovo() {
    setEditando(null)
    setCountryKey(''); setModalidadesSel(new Set()); setCode(''); setName(''); setAtivo(true)
    setCodeTouched(false); setNameTouched(false)
    setErroModal(null); setModalAberto(true)
  }
  function abrirEditar(t: Tipo) {
    setEditando(t)
    setCountryKey(t.countryKey); setModalidadesSel(new Set())
    setCode(t.code); setName(t.name); setAtivo(t.ativo)
    setCodeTouched(true); setNameTouched(true)
    setErroModal(null); setModalAberto(true)
  }

  function trocarPais(v: string) {
    setCountryKey(v)
    setModalidadesSel(new Set())
  }

  async function salvar() {
    if (!editando) {
      if (!countryKey) { setErroModal('Escolha o país.'); return }
      if (modalidadesSel.size === 0) { setErroModal('Escolha ao menos uma modalidade.'); return }
    }
    if (!code.trim()) { setErroModal('Informe o código.'); return }
    if (!name.trim()) { setErroModal('Informe o nome.'); return }
    setSalvando(true); setErroModal(null)
    try {
      if (editando) {
        // País e modalidades habilitadas NÃO mudam por aqui depois de
        // criado — este PUT só edita code/name/ativo (contrato do backend).
        const body = JSON.stringify({ code: code.trim(), name: name.trim(), ativo })
        await jsonFetch(`/api/gerenciamento/tipos-processo/${editando.id}`, { method: 'PUT', body })
      } else {
        // Manda a IDENTIDADE do país (paisId). `countryKey` segue junto só porque
        // o servidor aceita compatibilidade de borda — não usa esse texto como identidade.
        const body = JSON.stringify({ code: code.trim(), name: name.trim(), paisId: paisSel?.id, countryKey, modalityKeys: Array.from(modalidadesSel), ativo })
        await jsonFetch('/api/gerenciamento/tipos-processo', { method: 'POST', body })
      }
      setModalAberto(false)
      await carregar()
    } catch (e: any) {
      setErroModal(e.message || 'Não foi possível salvar.')
    } finally { setSalvando(false) }
  }

  async function excluir(t: Tipo) {
    if (!confirm(`Excluir o tipo de processo "${t.name}"?`)) return
    try {
      await jsonFetch(`/api/gerenciamento/tipos-processo/${t.id}`, { method: 'DELETE' })
      await carregar()
    } catch (e: any) {
      alert(e.message || 'Não foi possível excluir.')
    }
  }

  // ===== Gerenciar países =====
  function abrirPaises() {
    setVisao('lista'); setErroPais(null); setPaisesModal(true)
    carregarPaisesAdmin()
  }

  function abrirNovoPais() {
    setEditandoPais(null)
    setPLabel(''); setPFlag(''); setPNat(''); setPPrefix(''); setPMoeda('EUR')
    setPJud(true); setPAdm(true)
    setErroPais(null); setVisao('form')
  }

  function abrirEditarPais(p: Pais) {
    setEditandoPais(p)
    setPLabel(p.countryLabel); setPFlag(p.flag || ''); setPNat(p.nationalityLabel)
    setPPrefix(p.codePrefix || ''); setPMoeda(p.defaultCurrency || 'EUR')
    setErroPais(null); setVisao('form')
  }

  async function salvarPais() {
    const label = pLabel.trim()
    const nat = pNat.trim()
    if (!label) { setErroPais('Informe o nome do país.'); return }
    if (!nat) { setErroPais('Informe a nacionalidade.'); return }
    if (!editandoPais && !pJud && !pAdm) { setErroPais('Selecione ao menos uma modalidade.'); return }

    setSalvandoPais(true); setErroPais(null)
    try {
      if (editandoPais) {
        // EDITAR
        await jsonFetch(`/api/gerenciamento/paises/${editandoPais.countryKey}`, {
          method: 'PUT',
          body: JSON.stringify({
            countryLabel: label,
            flag: pFlag.trim() || null,
            nationalityLabel: nat,
            codePrefix: pPrefix.trim() || null,
            defaultCurrency: pMoeda,
          }),
        })
      } else {
        // CRIAR
        const mods: { modalityKey: string; modalityLabel: string; codeSuffix: string; ordem: number }[] = []
        if (pJud) mods.push({ modalityKey: 'judicial', modalityLabel: 'Judicial', codeSuffix: 'JUD', ordem: 0 })
        if (pAdm) mods.push({ modalityKey: 'administrativa', modalityLabel: 'Administrativa', codeSuffix: 'ADM', ordem: 1 })
        await jsonFetch('/api/gerenciamento/paises', {
          method: 'POST',
          body: JSON.stringify({
            countryLabel: label,
            flag: pFlag.trim() || null,
            nationalityLabel: nat,
            codePrefix: pPrefix.trim() || null,
            defaultCurrency: pMoeda,
            modalidades: mods,
          }),
        })
      }
      await Promise.all([carregarPaisesAdmin(), carregar()])
      setVisao('lista')
    } catch (e: any) {
      setErroPais(e.message || 'Não foi possível salvar o país.')
    } finally { setSalvandoPais(false) }
  }

  async function toggleAtivoPais(p: Pais) {
    try {
      await jsonFetch(`/api/gerenciamento/paises/${p.countryKey}`, {
        method: 'PUT',
        body: JSON.stringify({ ativo: !p.ativo }),
      })
      await Promise.all([carregarPaisesAdmin(), carregar()])
    } catch (e: any) {
      setErroPais(e.message || 'Não foi possível alterar o país.')
    }
  }

  async function excluirPais(p: Pais) {
    if (!confirm(`Excluir o país "${p.countryLabel}"? Só é possível se ele não tiver tipos nem processos.`)) return
    setErroPais(null)
    try {
      await jsonFetch(`/api/gerenciamento/paises/${p.countryKey}`, { method: 'DELETE' })
      await Promise.all([carregarPaisesAdmin(), carregar()])
    } catch (e: any) {
      setErroPais(e.message || 'Não foi possível excluir o país.')
    }
  }

  const inputCls = 'w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Processos de Nacionalidade</h2>
          <p className="text-sm text-[var(--text-secondary)]">Tipos de processo configuráveis — país, modalidade, código e nome.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={abrirPaises} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-[var(--surface-hover)] hover:text-white">
            Gerenciar países
          </button>
          <a href="?screen=modalidades" className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-[var(--surface-hover)] hover:text-white" title="Abre o cadastro dedicado de modalidades (Processos › Cadastros › Modalidades)">
            Gerenciar modalidades
          </a>
          <button onClick={abrirNovo} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)]">
            + Novo processo
          </button>
        </div>
      </div>

      {!loading && !erroLista && paises.length === 0 && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-sm text-amber-800">
          Nenhum país ativo no catálogo. Crie ou reative um em "Gerenciar países".
        </div>
      )}

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar processo..."
        className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2 text-sm text-white placeholder-white/30 outline-none backdrop-blur focus:border-white/20"
      />

      {loading && <div className="py-12 text-center text-sm text-[var(--text-muted)]">Carregando...</div>}

      {!loading && erroLista && (
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 text-sm text-red-700">
          {erroLista}<button onClick={() => void carregar()} className="ml-3 underline hover:text-white">Tentar de novo</button>
        </div>
      )}

      {!loading && !erroLista && filtrados.length === 0 && paises.length > 0 && (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] py-12 text-center text-sm text-[var(--text-muted)] backdrop-blur">
          {busca ? 'Nenhum processo encontrado.' : 'Nenhum tipo de processo ainda. Crie o primeiro.'}
        </div>
      )}

      {!loading && !erroLista && filtrados.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] backdrop-blur">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[var(--surface-primary)]">
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Código</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Processo</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">País</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Modalidade</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Status</th>
                <th className="border-b border-[var(--border-default)] px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((t) => {
                const flag = paises.find((p) => p.countryKey === t.countryKey)?.flag || ''
                return (
                  <tr key={t.id} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-primary)]">
                    <td className="px-4 py-2.5 font-mono text-[12px] text-white/80">{t.code}</td>
                    <td className="px-4 py-2.5 font-medium text-white">{t.name}</td>
                    <td className="px-4 py-2.5 text-white/70">{flag} {t.countryLabel}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {t.modalidades.map((m) => (
                          <span key={m.modalityKey} className="rounded-md bg-[var(--surface-secondary)] px-2 py-0.5 text-[11px] font-medium text-white/70">{m.modalityLabel}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {t.ativo
                        ? <span className="rounded-md bg-[var(--surface-secondary)] px-2 py-0.5 text-[11px] font-medium text-green-800">ativo</span>
                        : <span className="rounded-md bg-[var(--surface-primary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">inativo</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => abrirEditar(t)} className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-white/70 transition hover:bg-[var(--surface-hover)] hover:text-white">Editar</button>
                        <button onClick={() => excluir(t)} className="rounded-md border border-[var(--border-default)] px-2.5 py-1 text-xs text-red-700/80 transition hover:bg-[var(--surface-secondary)] hover:text-red-700">Excluir</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL: Novo/Editar processo */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
              <h3 className="text-lg font-semibold text-white">{editando ? 'Editar processo' : 'Novo processo de nacionalidade'}</h3>
              <button onClick={() => setModalAberto(false)} className="text-[var(--text-muted)] transition hover:text-white">✕</button>
            </div>

            <div className="space-y-4 px-6 py-4">
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]">País *</label>
                <select value={countryKey} onChange={(e) => trocarPais(e.target.value)} disabled={!!editando} className={inputCls + (editando ? ' opacity-50' : '')}>
                  <option value="" className="bg-zinc-900">— selecione —</option>
                  {paises.map((p) => <option key={p.countryKey} value={p.countryKey} className="bg-zinc-900">{p.flag ? p.flag + ' ' : ''}{p.countryLabel}</option>)}
                </select>
              </div>

              {/* Modalidade habilitada só se escolhe na CRIAÇÃO (checkboxes —
                  um Tipo pode habilitar Administrativa, Judicial ou ambas,
                  mesmo padrão de PaisesRegioesTab). Depois de criado, isso é
                  gerido em /[id]/modalidades — fora do escopo deste modal. */}
              {editando ? (
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Modalidades habilitadas</label>
                  <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
                    {editando.modalidades.map((m) => (
                      <span key={m.modalityKey} className="rounded-md bg-[var(--surface-secondary)] px-2 py-0.5 text-[11px] font-medium text-white/70">{m.modalityLabel}</span>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">Gerencie em "Gerenciar modalidades".</p>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Modalidade *</label>
                  <div className={'space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3' + (!countryKey ? ' opacity-50' : '')}>
                    {!countryKey && <p className="text-xs text-[var(--text-muted)]">Escolha o país primeiro.</p>}
                    {countryKey && modsAtivasDoPais.length === 0 && <p className="text-xs text-[var(--text-muted)]">Este país não tem modalidade cadastrada ainda.</p>}
                    {modsAtivasDoPais.map((m) => (
                      <label key={m.modalityKey} className="flex items-center gap-2 text-sm text-white/80">
                        <input type="checkbox" checked={modalidadesSel.has(m.modalityKey)} onChange={() => toggleModalidadeSel(m.modalityKey)} disabled={!countryKey} className="h-4 w-4 accent-blue-500" />
                        {m.modalityLabel}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Código *</label>
                  <input value={code} onChange={(e) => { setCode(e.target.value); setCodeTouched(true) }} placeholder="ITA-JUD" className={inputCls + ' font-mono'} />
                  {!codeTouched && sugCode && <p className="mt-1 text-[11px] text-[var(--text-muted)]">Sugerido automaticamente — pode editar.</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--text-secondary)]">Nome *</label>
                  <input value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true) }} placeholder="Nacionalidade Italiana · Judicial" className={inputCls} />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-white/80">
                <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                Ativo
              </label>

              {erroModal && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-sm text-red-700">{erroModal}</div>}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--border-default)] px-6 py-4">
              <button onClick={() => setModalAberto(false)} className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)] disabled:opacity-50">
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Gerenciar países (lista + criar/editar) */}
      {paisesModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay-modal)] p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-[var(--border-default)] bg-zinc-900/95 shadow-[var(--elev-3)]">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] px-6 py-4">
              <h3 className="text-lg font-semibold text-white">
                {visao === 'lista' ? 'Países' : editandoPais ? `Editar país — ${editandoPais.countryLabel}` : 'Novo país'}
              </h3>
              <button onClick={() => setPaisesModal(false)} className="text-[var(--text-muted)] transition hover:text-white">✕</button>
            </div>

            {visao === 'lista' && (
              <div className="space-y-3 px-6 py-4">
                <div className="flex justify-end">
                  <button onClick={abrirNovoPais} className="rounded-lg bg-[var(--action-primary)] px-3 py-1.5 text-sm font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)]">
                    + Novo país
                  </button>
                </div>

                {carregandoPaises && <div className="py-8 text-center text-sm text-[var(--text-muted)]">Carregando...</div>}

                {!carregandoPaises && paisesAdmin.length === 0 && (
                  <div className="py-8 text-center text-sm text-[var(--text-muted)]">Nenhum país cadastrado.</div>
                )}

                {!carregandoPaises && paisesAdmin.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-[var(--border-default)]">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="bg-[var(--surface-primary)]">
                          <th className="border-b border-[var(--border-default)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">País</th>
                          <th className="border-b border-[var(--border-default)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Nacionalidade</th>
                          <th className="border-b border-[var(--border-default)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Tipos</th>
                          <th className="border-b border-[var(--border-default)] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Status</th>
                          <th className="border-b border-[var(--border-default)] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paisesAdmin.map((p) => (
                          <tr key={p.countryKey} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--surface-primary)]">
                            <td className="px-3 py-2 font-medium text-white">{p.flag ? p.flag + ' ' : ''}{p.countryLabel}</td>
                            <td className="px-3 py-2 text-white/70">{p.nationalityLabel}</td>
                            <td className="px-3 py-2 text-white/70">{p.tiposCount ?? 0}</td>
                            <td className="px-3 py-2">
                              {p.ativo
                                ? <span className="rounded-md bg-[var(--surface-secondary)] px-2 py-0.5 text-[11px] font-medium text-green-800">ativo</span>
                                : <span className="rounded-md bg-[var(--surface-primary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">inativo</span>}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-1.5">
                                <button onClick={() => abrirEditarPais(p)} className="rounded-md border border-[var(--border-default)] px-2 py-1 text-xs text-white/70 transition hover:bg-[var(--surface-hover)] hover:text-white">Editar</button>
                                <button onClick={() => toggleAtivoPais(p)} className="rounded-md border border-[var(--border-default)] px-2 py-1 text-xs text-white/70 transition hover:bg-[var(--surface-hover)] hover:text-white">
                                  {p.ativo ? 'Inativar' : 'Ativar'}
                                </button>
                                <button onClick={() => excluirPais(p)} className="rounded-md border border-[var(--border-default)] px-2 py-1 text-xs text-red-700/80 transition hover:bg-[var(--surface-secondary)] hover:text-red-700">Excluir</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <p className="text-[11px] text-[var(--text-muted)]">
                  Excluir só funciona para país sem tipos e sem processos. Se já estiver em uso, use "Inativar" — ele some do kanban e dos cadastros, sem apagar nada.
                </p>

                {erroPais && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-sm text-red-700">{erroPais}</div>}
              </div>
            )}

            {visao === 'form' && (
              <>
                <div className="space-y-4 px-6 py-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs text-[var(--text-secondary)]">Nome do país *</label>
                      <input value={pLabel} onChange={(e) => setPLabel(e.target.value)} placeholder="França" className={inputCls} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-[var(--text-secondary)]">Bandeira</label>
                      <input value={pFlag} onChange={(e) => setPFlag(e.target.value)} placeholder="🇫🇷" className={inputCls} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs text-[var(--text-secondary)]">Nacionalidade *</label>
                      <input value={pNat} onChange={(e) => setPNat(e.target.value)} placeholder="Francesa" className={inputCls} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-[var(--text-secondary)]">Prefixo do código</label>
                      <input value={pPrefix} onChange={(e) => setPPrefix(e.target.value)} placeholder="FRA" className={inputCls + ' font-mono'} />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-[var(--text-secondary)]">Moeda padrão</label>
                    <select value={pMoeda} onChange={(e) => setPMoeda(e.target.value)} className={inputCls}>
                      <option value="EUR" className="bg-zinc-900">EUR</option>
                      <option value="USD" className="bg-zinc-900">USD</option>
                      <option value="BRL" className="bg-zinc-900">BRL</option>
                    </select>
                  </div>

                  {!editandoPais && (
                    <div>
                      <label className="mb-1 block text-xs text-[var(--text-secondary)]">Modalidades</label>
                      <div className="space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
                        <label className="flex items-center gap-2 text-sm text-white/80">
                          <input type="checkbox" checked={pJud} onChange={(e) => setPJud(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                          Judicial
                        </label>
                        <label className="flex items-center gap-2 text-sm text-white/80">
                          <input type="checkbox" checked={pAdm} onChange={(e) => setPAdm(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                          Administrativa
                        </label>
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--text-muted)]">O país precisa de pelo menos uma modalidade para ser usado.</p>
                    </div>
                  )}

                  {erroPais && <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-sm text-red-700">{erroPais}</div>}
                </div>

                <div className="flex items-center justify-between gap-2 border-t border-[var(--border-default)] px-6 py-4">
                  <button onClick={() => { setVisao('lista'); setErroPais(null) }} className="rounded-lg px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-white">← Voltar</button>
                  <button onClick={salvarPais} disabled={salvandoPais} className="rounded-lg bg-[var(--action-primary)] px-4 py-2 text-sm font-medium text-[var(--action-primary-ink)] transition hover:bg-[var(--action-primary)] disabled:opacity-50">
                    {salvandoPais ? 'Salvando...' : editandoPais ? 'Salvar alterações' : 'Criar país'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}