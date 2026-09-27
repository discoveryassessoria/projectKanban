import { useCallback, useMemo } from 'react'
import useSWR from 'swr'

const fetcher = async (url: string) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  
  if (!token) {
    throw new Error('Sem token')
  }
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  })
  
  if (!res.ok) {
    throw new Error(`Erro ao buscar permissões: ${res.status}`)
  }
  
  return res.json()
}

export function usePermissoes() {
  const { data, error, isLoading } = useSWR('/api/me/permissoes', fetcher, {
    revalidateOnFocus: false,        // não rebuscar a cada vez que muda de aba
    revalidateOnReconnect: true,      // rebuscar se reconectar internet
    dedupingInterval: 60000,          // dedup por 60s — chave do ganho
    errorRetryCount: 2,
  })

  // MEMOIZADO (achado real, 27/09/2026): `data?.permissoes || {}` cria um objeto
  // NOVO sempre que `data` ainda não chegou (o `{}` do fallback) — sem o
  // useMemo, `pode` (abaixo) ficaria instável nesse intervalo mesmo depois do
  // useCallback.
  const permissoes: Record<string, boolean> = useMemo(() => data?.permissoes || {}, [data?.permissoes])
  // MEMOIZADO: uma arrow function nova a cada chamada do hook — ou seja, a
  // cada render de QUALQUER componente que o usa — vira uma identidade
  // instável em quem depende dela num useEffect. Causou um loop de >18.500
  // requisições/2min em ProcessoCentralOperacional.tsx (efeito com `[pode]`
  // refazendo fetch a cada render, e o próprio `setState` do fetch já sendo o
  // próximo render) e exigia um workaround manual por ref em
  // administrator/page.tsx. `pode` só precisa mudar de identidade quando
  // `permissoes` de fato mudar.
  const pode = useCallback((chave: string) => !!permissoes[chave], [permissoes])
  const tipo: string | null = data?.tipo ?? null
  const userId: number | null = data?.userId ?? null

  return {
    permissoes,
    pode,
    tipo,
    userId,
    isAdmin: tipo === 'admin',   // ações destrutivas (exclusão definitiva) — SEMPRE revalidado no backend
    carregando: isLoading,
    erro: error
  }
}