'use client'

// src/components/gerenciamentoComponents/CatalogTab.tsx
// Tela genérica de catálogo — UMA tela cobre 16 itens de menu (Documentos, parte do
// Financeiro, Fornecedores, Departamentos, etc.). Portado de renderMgCatalog() do mockup.
// TEMA: glass escuro, igual à casca (page.tsx), OverviewTab, UsersTab e RolesTab.
//
// Uso na page.tsx (mapa TELAS), via wrapper que fixa o catalogKey:
//   const CatalogTab = dynamic(() => import('@/src/components/gerenciamentoComponents/CatalogTab'), { ssr: false })
//   const cat = (k: string) => () => <CatalogTab catalogKey={k} />
//   banks: cat('fin_banks'),
//
// SCAFFOLD: estrutura, colunas e formulário fiéis ao mockup. LISTAGEM e SALVAR
// serão ligados ao banco na etapa de wiring (por isso a tabela abre vazia).

import { useState } from 'react'
import { MG_CATALOG, type CatalogField } from './gerenciamentoCatalogs'

type Row = Record<string, any>

export default function CatalogTab({ catalogKey }: { catalogKey: string }) {
  const cfg = MG_CATALOG[catalogKey]
  const [rows] = useState<Row[]>([]) // wiring depois
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Row>({})

  if (!cfg) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur">
        <div className="text-sm font-semibold text-white/80">Cadastro ainda não configurado</div>
        <div className="mt-1 text-xs text-white/40">
          O item <code className="rounded bg-white/10 px-1">{catalogKey}</code> existe no menu mas não tem
          configuração de catálogo. Será definido numa próxima etapa.
        </div>
      </div>
    )
  }

  const headers = [...cfg.cols.map((c) => c[1]), 'Status', 'Ações']

  function abrirNovo() {
    setEditId(null)
    setForm({})
    setModalOpen(true)
  }

  function setField(key: string, value: any) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function salvar() {
    // TODO (wiring): POST/PUT no banco. Por enquanto só fecha.
    setModalOpen(false)
  }

  return (
    <div className="text-white">
      <div className="mb-3 text-xs text-white/50">{cfg.desc}</div>

      {/* título da seção + ações */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-white">{cfg.title}</h2>
        <div className="flex items-center gap-2">
          <button className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white">
            Exportar
          </button>
          <button
            onClick={abrirNovo}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500"
          >
            + Novo
          </button>
        </div>
      </div>

      {/* tabela */}
      <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 backdrop-blur">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-white/5">
              {headers.map((h, i) => (
                <th
                  key={i}
                  className={`border-b border-white/10 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-white/50 ${
                    i === headers.length - 1 ? 'text-right' : 'text-left'
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="px-3 py-6 text-center text-xs text-white/40">
                  Nenhum cadastro. Clique em “+ Novo” para começar.
                </td>
              </tr>
            ) : (
              rows.map((ent, ri) => (
                <tr key={ri} className="transition hover:bg-white/5">
                  {cfg.cols.map((c, ci) => (
                    <td key={ci} className="border-b border-white/10 px-3 py-2.5 text-white/80">
                      {String(ent[c[0]] ?? '')}
                    </td>
                  ))}
                  <td className="border-b border-white/10 px-3 py-2.5">
                    <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-green-300">
                      ativo
                    </span>
                  </td>
                  <td className="whitespace-nowrap border-b border-white/10 px-3 py-2.5 text-right">
                    <RowBtn>Editar</RowBtn>
                    <RowBtn>Duplicar</RowBtn>
                    <RowBtn>Desativar</RowBtn>
                    <RowBtn danger>Excluir</RowBtn>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* modal criar/editar */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <h3 className="text-base font-semibold text-white">
                {editId ? 'Editar' : 'Novo'} · {cfg.title}
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-white/40 transition hover:text-white">
                ✕
              </button>
            </div>

            <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto px-5 py-4 sm:grid-cols-2">
              {cfg.fields.map((f) => (
                <Field key={f.key} field={f} value={form[f.key]} onChange={(v) => setField(f.key, v)} />
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3.5">
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg px-4 py-2 text-sm text-white/60 transition hover:text-white"
              >
                Cancelar
              </button>
              <button
                onClick={salvar}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RowBtn({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      className={`ml-1 rounded border border-white/10 px-1.5 py-0.5 text-[10px] transition hover:bg-white/10 ${
        danger ? 'text-red-300/80 hover:text-red-200' : 'text-white/70 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function Field({
  field,
  value,
  onChange,
}: {
  field: CatalogField
  value: any
  onChange: (v: any) => void
}) {
  const base =
    'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white outline-none focus:border-white/20'

  let input: React.ReactNode
  if (field.type === 'select') {
    input = (
      <select className={base} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {!field.required && <option value="">—</option>}
        {field.optionsSource ? (
          <option value="" disabled>
            (ligado ao banco depois)
          </option>
        ) : (
          (field.options || []).map((o) => (
            <option key={o} value={o} className="bg-zinc-900">
              {o}
            </option>
          ))
        )}
      </select>
    )
  } else if (field.type === 'bool' || field.type === 'boolean') {
    input = (
      <select className={base} value={value ? '1' : '0'} onChange={(e) => onChange(e.target.value === '1')}>
        <option value="1" className="bg-zinc-900">Sim</option>
        <option value="0" className="bg-zinc-900">Não</option>
      </select>
    )
  } else if (field.type === 'number') {
    input = (
      <input
        type="number"
        step="0.01"
        className={base}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    )
  } else {
    input = <input className={base} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  }

  return (
    <div>
      <label className="mb-1 block text-[11px] text-white/60">
        {field.label}
        {field.required ? ' *' : ''}
      </label>
      {input}
    </div>
  )
}