// ESTE ARQUIVO VAI EM: src/services/userService.ts

interface User {
  id?: number
  nome: string
  email: string
  senha?: string
  tipo: string
}

// Função auxiliar para obter o token
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem("authToken")
}

// Função auxiliar para fazer requisições autenticadas
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<any | null> {
  const token = getAuthToken()
  
  if (!token) {
    return null
  }

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    ...options.headers,
  }

  try {
    const response = await fetch(url, { ...options, headers })
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return null
      }
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || `Erro na requisição: ${response.status}`)
    }

    return await response.json()
  } catch (error: any) {
    if (error.message && !error.message.includes('autenticado')) {
      throw error
    }
    return null
  }
}

// Buscar todos os usuários
export async function getUsers(search?: string): Promise<User[]> {
  const url = search 
    ? `/api/usuarios?search=${encodeURIComponent(search)}&all=true`
    : '/api/usuarios?all=true'
  
  const data = await fetchWithAuth(url)
  
  if (data === null) {
    return []
  }
  
  return data.usuarios || []
}

// Criar novo usuário - rota pública, não precisa de autenticação
export async function createUser(userData: User): Promise<User> {
  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(userData),
    })
    
    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(data.error || data.message || "Erro ao criar usuário")
    }
    
    return data.user || data.usuario
  } catch (error: any) {
    console.error("Erro ao criar usuário:", error)
    throw error
  }
}

// Atualizar usuário existente
export async function updateUser(userId: number, userData: Partial<User>): Promise<User | null> {
  const data = await fetchWithAuth(`/api/usuarios/${userId}`, {
    method: 'PUT',
    body: JSON.stringify(userData),
  })
  
  if (data === null) {
    throw new Error("Sessão expirada. Faça login novamente.")
  }
  
  return data.usuario
}

// Deletar usuário
export async function deleteUser(userId: number): Promise<boolean> {
  const result = await fetchWithAuth(`/api/usuarios/${userId}`, {
    method: 'DELETE',
  })
  
  if (result === null) {
    throw new Error("Sessão expirada. Faça login novamente.")
  }
  
  return true
}