import { useState, useEffect } from 'react'

export function usePermissoes() {
  const [permissoes, setPermissoes] = useState<Record<string, boolean>>({})
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('authToken')
    if (!token) {
      setCarregando(false)
      return
    }

    fetch('/api/me/permissoes', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        setPermissoes(data.permissoes || {})
      })
      .catch(() => {})
      .finally(() => setCarregando(false))
  }, [])

  const pode = (chave: string) => !!permissoes[chave]

  return { permissoes, pode, carregando }
}