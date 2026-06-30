'use client';

import { useEffect, useMemo, useState } from 'react';

/* ============================================================
   FASE 2A — Modelos Internos de Fase (biblioteca mestre)
   Porte fiel do mockup `imtemplates` (renderManagementInternalModeTemplates)
   - Tema escuro/glass do app
   - Categoria (fase principal) = âncora @@unique([category, modeKey])
   - recommendedPhases (multi) puxado do CatalogoFase (1B)
   - "Aplicar em fase" = placeholder (vira real na Fase 3)
   ============================================================ */

type Fase = { phaseKey: string; label: string };

type Modelo = {
  id: number;
  name: string;
  modeKey: string;
  category: string | null;
  recommendedPhases: string[] | null;
  description: string | null;
  conditionOfUse: string | null;
  operationalImpact: string | null;
  documentalImpact: string | null;
  financialImpact: string | null;
  protocolImpact: string | null;
  isSystemTemplate: boolean;
  usedByCount: number;
  arquivado: boolean;
};

type FormState = {
  name: string;
  modeKey: string;
  category: string;
  status: 'active' | 'archived';
  recommendedPhases: string[];
  description: string;
  conditionOfUse: string;
  operationalImpact: string;
  documentalImpact: string;
  financialImpact: string;
  protocolImpact: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  modeKey: '',
  category: '',
  status: 'active',
  recommendedPhases: [],
  description: '',
  conditionOfUse: '',
  operationalImpact: '',
  documentalImpact: '',
  financialImpact: '',
  protocolImpact: '',
};

function slug(s: string) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function jsonFetch(url: string, opts: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
  return data;
}

const BASE = '/api/gerenciamento/modelos-internos';

export default function ModelosInternosFaseTab() {
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [fases, setFases] = useState<Fase[]>([]);
  const [loading, setLoading] = useState(true);
  const [erroCarregar, setErroCarregar] = useState('');

  // filtros / busca
  const [busca, setBusca] = useState('');
  const [fCat, setFCat] = useState('');
  const [fStatus, setFStatus] = useState<'' | 'active' | 'archived'>('');

  // modal
  const [modalAberto, setModalAberto] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [keyTouched, setKeyTouched] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState('');

  // banners
  const [sucesso, setSucesso] = useState('');
  const [info, setInfo] = useState('');

  const faseLabel = useMemo(() => {
    const m = new Map(fases.map((f) => [f.phaseKey, f.label]));
    return (k: string) => m.get(k) || k;
  }, [fases]);

  async function carregar() {
    setLoading(true);
    setErroCarregar('');
    try {
      const data = await jsonFetch(BASE);
      setModelos(data.modelos || []);
      setFases(data.catalogoFases || []);
    } catch (e: any) {
      setErroCarregar(e.message || 'Falha ao carregar.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  function flashSucesso(msg: string) {
    setSucesso(msg);
    window.setTimeout(() => setSucesso(''), 3500);
  }
  function flashInfo(msg: string) {
    setInfo(msg);
    window.setTimeout(() => setInfo(''), 4000);
  }

  // -------- filtros --------
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return modelos.filter((m) => {
      if (fStatus === 'active' && m.arquivado) return false;
      if (fStatus === 'archived' && !m.arquivado) return false;
      if (fCat) {
        const inRec = Array.isArray(m.recommendedPhases) && m.recommendedPhases.includes(fCat);
        if (m.category !== fCat && !inRec) return false;
      }
      if (q) {
        const hay = `${m.name} ${m.modeKey} ${m.description || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [modelos, busca, fCat, fStatus]);

  // -------- modal --------
  function abrirNovo() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setKeyTouched(false);
    setErroModal('');
    setModalAberto(true);
  }
  function abrirEditar(m: Modelo) {
    setEditId(m.id);
    setForm({
      name: m.name || '',
      modeKey: m.modeKey || '',
      category: m.category || '',
      status: m.arquivado ? 'archived' : 'active',
      recommendedPhases: Array.isArray(m.recommendedPhases) ? m.recommendedPhases : [],
      description: m.description || '',
      conditionOfUse: m.conditionOfUse || '',
      operationalImpact: m.operationalImpact || '',
      documentalImpact: m.documentalImpact || '',
      financialImpact: m.financialImpact || '',
      protocolImpact: m.protocolImpact || '',
    });
    setKeyTouched(true);
    setErroModal('');
    setModalAberto(true);
  }
  function fecharModal() {
    setModalAberto(false);
    setEditId(null);
  }

  function setName(v: string) {
    setForm((f) => ({ ...f, name: v, modeKey: keyTouched ? f.modeKey : slug(v) }));
  }
  function toggleRec(phaseKey: string) {
    setForm((f) => {
      const has = f.recommendedPhases.includes(phaseKey);
      return {
        ...f,
        recommendedPhases: has
          ? f.recommendedPhases.filter((k) => k !== phaseKey)
          : [...f.recommendedPhases, phaseKey],
      };
    });
  }

  async function salvar() {
    if (!form.name.trim()) { setErroModal('Dê um nome ao modelo.'); return; }
    setSalvando(true);
    setErroModal('');
    const payload = {
      name: form.name.trim(),
      modeKey: (form.modeKey.trim() || slug(form.name)),
      category: form.category || null,
      recommendedPhases: form.recommendedPhases,
      description: form.description,
      conditionOfUse: form.conditionOfUse,
      operationalImpact: form.operationalImpact,
      documentalImpact: form.documentalImpact,
      financialImpact: form.financialImpact,
      protocolImpact: form.protocolImpact,
      arquivado: form.status === 'archived',
    };
    try {
      if (editId == null) {
        await jsonFetch(BASE, { method: 'POST', body: JSON.stringify(payload) });
        flashSucesso('Modelo interno criado.');
      } else {
        await jsonFetch(`${BASE}/${editId}`, { method: 'PUT', body: JSON.stringify(payload) });
        flashSucesso('Modelo interno atualizado.');
      }
      fecharModal();
      await carregar();
    } catch (e: any) {
      setErroModal(e.message || 'Erro ao salvar.');
    } finally {
      setSalvando(false);
    }
  }

  // -------- ações de linha --------
  async function duplicar(m: Modelo) {
    const payload = {
      name: `${m.name} (cópia)`,
      modeKey: `${m.modeKey}_copia`,
      category: m.category,
      recommendedPhases: Array.isArray(m.recommendedPhases) ? m.recommendedPhases : [],
      description: m.description || '',
      conditionOfUse: m.conditionOfUse || '',
      operationalImpact: m.operationalImpact || '',
      documentalImpact: m.documentalImpact || '',
      financialImpact: m.financialImpact || '',
      protocolImpact: m.protocolImpact || '',
      arquivado: false,
    };
    try {
      await jsonFetch(BASE, { method: 'POST', body: JSON.stringify(payload) });
      flashSucesso('Modelo duplicado.');
      await carregar();
    } catch (e: any) {
      flashInfo(
        e.message?.includes('Já existe')
          ? 'Já existe uma cópia com essa chave. Edite a chave técnica da cópia antes de duplicar de novo.'
          : (e.message || 'Erro ao duplicar.'),
      );
    }
  }

  function aplicarEmFase() {
    flashInfo('“Aplicar em fase” fica disponível na Fase 3 (aplicação de modelos por fase do processo).');
  }

  async function alternarArquivo(m: Modelo) {
    if (!m.arquivado && !confirm('Arquivar este modelo? Ele não poderá ser aplicado em novas fases, mas as aplicações existentes continuam.')) return;
    try {
      await jsonFetch(`${BASE}/${m.id}`, { method: 'PUT', body: JSON.stringify({ arquivado: !m.arquivado }) });
      flashSucesso(m.arquivado ? 'Modelo reativado.' : 'Modelo arquivado.');
      await carregar();
    } catch (e: any) {
      flashInfo(e.message || 'Erro ao alterar status.');
    }
  }

  async function excluir(m: Modelo) {
    if (!confirm(`Excluir definitivamente o modelo "${m.name}"?`)) return;
    try {
      await jsonFetch(`${BASE}/${m.id}`, { method: 'DELETE' });
      flashSucesso('Modelo excluído.');
      await carregar();
    } catch (e: any) {
      flashInfo(e.message || 'Erro ao excluir.');
    }
  }

  // -------- helpers de render --------
  function impactoTags(m: Modelo) {
    const t = [
      m.operationalImpact ? 'op' : '',
      m.documentalImpact ? 'doc' : '',
      m.financialImpact ? 'fin' : '',
      m.protocolImpact ? 'prot' : '',
    ].filter(Boolean);
    return t.length ? t.join(' · ') : '—';
  }
  function recLabels(m: Modelo) {
    const arr = Array.isArray(m.recommendedPhases) ? m.recommendedPhases : [];
    if (arr.length) return arr.map(faseLabel).join(', ');
    return m.category ? faseLabel(m.category) : '—';
  }

  const inputCls =
    'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/20';
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-wide text-white/60 mb-1';

  return (
    <>
    <div className="rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm text-white md:p-6">
      {/* Cabeçalho */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Modelos Internos de Fase</h2>
          <p className="mt-1 max-w-2xl text-xs text-white/60">
            Biblioteca mestre de modos internos reutilizáveis. Cadastre aqui variações como Judicial,
            Administrativa, Mista ou Não necessária, que depois serão aplicadas dentro das fases dos
            Processos de Nacionalidade.
          </p>
        </div>
        <button
          onClick={abrirNovo}
          className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500"
        >
          + Novo modelo interno
        </button>
      </div>

      {/* Banners */}
      {sucesso && (
        <div className="mb-3 rounded-lg border border-green-600/40 bg-green-600/15 px-3 py-2 text-sm text-green-300">
          {sucesso}
        </div>
      )}
      {info && (
        <div className="mb-3 rounded-lg border border-blue-500/40 bg-blue-600/15 px-3 py-2 text-sm text-blue-300">
          {info}
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar modelo..."
          className="min-w-[180px] rounded-lg bg-white/5 border border-white/15 px-3 py-1.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
        />
        <select
          value={fCat}
          onChange={(e) => setFCat(e.target.value)}
          className="rounded-lg bg-white/5 border border-white/15 px-2 py-1.5 text-sm text-white"
        >
          <option value="" className="bg-zinc-900">Todas as fases</option>
          {fases.map((f) => (
            <option key={f.phaseKey} value={f.phaseKey} className="bg-zinc-900">{f.label}</option>
          ))}
        </select>
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value as any)}
          className="rounded-lg bg-white/5 border border-white/15 px-2 py-1.5 text-sm text-white"
        >
          <option value="" className="bg-zinc-900">Todos</option>
          <option value="active" className="bg-zinc-900">Ativos</option>
          <option value="archived" className="bg-zinc-900">Arquivados</option>
        </select>
        <span className="ml-auto text-xs text-white/40">{filtrados.length} modelo(s)</span>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/5">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-white/10 text-left text-[10.5px] uppercase tracking-wide text-white/60">
              <th className="px-3 py-2.5 font-bold">Modelo</th>
              <th className="px-3 py-2.5 font-bold">Chave</th>
              <th className="px-3 py-2.5 font-bold">Fases recomendadas</th>
              <th className="px-3 py-2.5 font-bold">Impacto</th>
              <th className="px-3 py-2.5 font-bold">Status</th>
              <th className="px-3 py-2.5 text-center font-bold">Usado em</th>
              <th className="px-3 py-2.5 text-right font-bold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-white/40">Carregando…</td></tr>
            ) : erroCarregar ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-red-400">{erroCarregar}</td></tr>
            ) : filtrados.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-white/40">Nenhum modelo. Clique em “+ Novo modelo interno”.</td></tr>
            ) : (
              filtrados.map((m) => {
                const podeExcluir = (m.usedByCount || 0) === 0;
                return (
                  <tr key={m.id} className="border-t border-white/10 hover:bg-white/5">
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-white">{m.name}</span>
                        {m.isSystemTemplate && (
                          <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold text-white/80">padrão</span>
                        )}
                      </div>
                      {m.description && (
                        <div className="mt-0.5 text-[11px] text-white/40">{m.description}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top text-[11px] text-white/60">{m.modeKey}</td>
                    <td className="px-3 py-2.5 align-top text-[11px] text-white/80">{recLabels(m)}</td>
                    <td className="px-3 py-2.5 align-top text-[10.5px] text-white/40">{impactoTags(m)}</td>
                    <td className="px-3 py-2.5 align-top">
                      {m.arquivado ? (
                        <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold text-white/80">arquivado</span>
                      ) : (
                        <span className="rounded bg-green-600/20 px-1.5 py-0.5 text-[10px] font-bold text-green-300">ativo</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top text-center text-[11px] text-white/80">{m.usedByCount || 0}</td>
                    <td className="px-3 py-2.5 align-top text-right whitespace-nowrap">
                      <div className="inline-flex flex-wrap justify-end gap-1">
                        <button onClick={() => abrirEditar(m)} className="rounded px-2 py-1 text-[11px] text-white/80 hover:bg-white/10 hover:text-white">Editar</button>
                        <button onClick={() => duplicar(m)} className="rounded px-2 py-1 text-[11px] text-white/80 hover:bg-white/10 hover:text-white">Duplicar</button>
                        <button onClick={aplicarEmFase} title="Disponível na Fase 3" className="rounded px-2 py-1 text-[11px] text-white/40 hover:bg-white/10 hover:text-white/80">Aplicar em fase</button>
                        {m.arquivado ? (
                          <button onClick={() => alternarArquivo(m)} className="rounded px-2 py-1 text-[11px] text-green-400 hover:bg-white/10">Reativar</button>
                        ) : (
                          <button onClick={() => alternarArquivo(m)} className="rounded px-2 py-1 text-[11px] text-amber-400 hover:bg-white/10">Arquivar</button>
                        )}
                        {podeExcluir && (
                          <button onClick={() => excluir(m)} className="rounded px-2 py-1 text-[11px] text-red-400 hover:bg-white/10">Excluir</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>

      {/* Modal criar/editar */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-white/10 bg-zinc-900/95 p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                {editId == null ? 'Novo' : 'Editar'} modelo interno de fase
              </h3>
              <button onClick={fecharModal} className="text-white/60 hover:text-white">✕</button>
            </div>

            {erroModal && (
              <div className="mb-3 rounded-lg border border-red-600/40 bg-red-600/15 px-3 py-2 text-sm text-red-300">
                {erroModal}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Nome do modelo *</label>
                <input value={form.name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Chave técnica</label>
                <input
                  value={form.modeKey}
                  onChange={(e) => { setKeyTouched(true); setForm((f) => ({ ...f, modeKey: e.target.value })); }}
                  placeholder="ex: judicial"
                  className={inputCls}
                />
              </div>

              <div className="sm:col-span-2">
                <label className={labelCls}>Descrição</label>
                <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className={inputCls} />
              </div>

              <div>
                <label className={labelCls}>Categoria (fase principal)</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className={inputCls}
                >
                  <option value="" className="bg-zinc-900">— selecione —</option>
                  {fases.map((f) => (
                    <option key={f.phaseKey} value={f.phaseKey} className="bg-zinc-900">{f.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'active' | 'archived' }))}
                  className={inputCls}
                >
                  <option value="active" className="bg-zinc-900">ativo</option>
                  <option value="archived" className="bg-zinc-900">arquivado</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className={labelCls}>Fases recomendadas</label>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg bg-white/10 p-3">
                  {fases.map((f) => (
                    <label key={f.phaseKey} className="inline-flex items-center gap-1.5 text-[12px] text-white/80">
                      <input
                        type="checkbox"
                        checked={form.recommendedPhases.includes(f.phaseKey)}
                        onChange={() => toggleRec(f.phaseKey)}
                        className="h-3.5 w-3.5 rounded border-white/15 bg-white/15 text-blue-600 focus:ring-blue-600/50"
                      />
                      {f.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className={labelCls}>Condição de uso</label>
                <input value={form.conditionOfUse} onChange={(e) => setForm((f) => ({ ...f, conditionOfUse: e.target.value }))} className={inputCls} />
              </div>

              {/* Impactos recolhíveis */}
              <details className="sm:col-span-2 rounded-lg border border-white/15 px-3 py-2">
                <summary className="cursor-pointer text-xs text-white/60">
                  Impactos (operacional, documental, financeiro, protocolo)
                </summary>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Impacto operacional</label>
                    <input value={form.operationalImpact} onChange={(e) => setForm((f) => ({ ...f, operationalImpact: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Impacto documental</label>
                    <input value={form.documentalImpact} onChange={(e) => setForm((f) => ({ ...f, documentalImpact: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Impacto financeiro</label>
                    <input value={form.financialImpact} onChange={(e) => setForm((f) => ({ ...f, financialImpact: e.target.value }))} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Impacto de protocolo</label>
                    <input value={form.protocolImpact} onChange={(e) => setForm((f) => ({ ...f, protocolImpact: e.target.value }))} className={inputCls} />
                  </div>
                </div>
              </details>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={fecharModal} className="rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/5">Cancelar</button>
              <button
                onClick={salvar}
                disabled={salvando}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
              >
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}