"use client"

// src/components/arvore/aviso-pessoa-repetida.tsx
// ============================================================================
// AVISO "JÁ EXISTE UMA PESSOA PARECIDA NO PROCESSO X" (Etapa 6a).
//
// Informativo: NÃO bloqueia salvar, NÃO funde, NÃO vincula. Só consulta quando há
// nome de 3+ letras e data de nascimento completa (e o usuário pode ver processos),
// com debounce — digitar não dispara uma consulta por tecla.
// ============================================================================

import { useEffect, useState } from "react"
import { AlertTriangle, ExternalLink } from "lucide-react"
import { usePermissoes } from "@/src/hooks/use-permissoes"
import { parametrosDaConsulta, type PessoaRepetidaCandidata } from "@/src/lib/genealogia/pessoa-repetida"

export const DEBOUNCE_PESSOA_REPETIDA_MS = 500

export function usePessoasParecidas(entrada: {
  nome: string
  sobrenome: string
  dataNascimento: string
  arvoreId: number
  /** false desliga a consulta (ex.: edição sem mudança em nome/data). */
  ativo?: boolean
}): PessoaRepetidaCandidata[] {
  const { pode } = usePermissoes()
  const podeVer = pode("processos.ver")
  const [achados, setAchados] = useState<{ chave: string; lista: PessoaRepetidaCandidata[] }>({ chave: "", lista: [] })
  const params = parametrosDaConsulta(entrada)
  const chave = params && podeVer && entrada.ativo !== false ? `${entrada.arvoreId}|${params.nome}|${params.sobrenome}|${params.dataNascimento}` : ""

  useEffect(() => {
    if (!chave || !params) return
    const controle = new AbortController()
    const t = setTimeout(async () => {
      try {
        const token = typeof window !== "undefined" ? localStorage.getItem("authToken") : null
        const q = new URLSearchParams({
          nome: params.nome,
          sobrenome: params.sobrenome,
          dataNascimento: params.dataNascimento,
          arvoreId: String(entrada.arvoreId),
        })
        const r = await fetch(`/api/genealogy/pessoas-repetidas?${q}`, {
          signal: controle.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!r.ok) return
        const json = (await r.json()) as { candidatos?: PessoaRepetidaCandidata[] }
        setAchados({ chave, lista: json.candidatos ?? [] })
      } catch {
        /* aviso é informativo: falha de rede não vira erro na tela */
      }
    }, DEBOUNCE_PESSOA_REPETIDA_MS)
    return () => {
      clearTimeout(t)
      controle.abort()
    }
    // `params` deriva de `chave`; depender de `chave` evita refazer a consulta a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  return achados.chave === chave && chave ? achados.lista : []
}

function dataBR(iso: string): string {
  const [a, m, d] = iso.split("-")
  return `${d}/${m}/${a}`
}

export function AvisoPessoaRepetida({ candidatos }: { candidatos: PessoaRepetidaCandidata[] }) {
  if (candidatos.length === 0) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-aviso="pessoa-repetida"
      className="mt-3 rounded-lg border border-[var(--warning)] bg-[var(--warning-tile)] p-3 text-sm text-[var(--warning-text)]"
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--warning-text)]" aria-hidden="true" />
        <span>Já existe uma pessoa parecida em outro processo. Confira antes de salvar — este aviso não bloqueia.</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {candidatos.map((c) => (
          <li key={c.pessoaId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              <strong>{c.nome}</strong> ({dataBR(c.dataNascimento)}) — processo {c.processo.codigo ?? `#${c.processo.id}`} · {c.processo.nome}
            </span>
            <a
              href={c.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-[var(--action-primary)] hover:underline"
            >
              Abrir <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
