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

  const permissoes: Record<string, boolean> = data?.permissoes || {}
  const pode = (chave: string) => !!permissoes[chave]

  return { 
    permissoes, 
    pode, 
    carregando: isLoading,
    erro: error
  }
}