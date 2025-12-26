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
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<any> {
  const token = getAuthToken()
  
  if (!token) {
    throw new Error("Você precisa estar autenticado")
  }

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    ...options.headers,
  }

  const response = await fetch(url, { ...options, headers })
  const data = await response.json().catch(() => ({}))
  
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Sessão expirada. Faça login novamente.")
    }
    
    // Mostrar erro real da API (ex: "Você não pode editar outro administrador")
    throw new Error(data.error || `Erro na requisição: ${response.status}`)
  }

  return data
}

// Buscar todos os usuários
export async function getUsers(search?: string): Promise<User[]> {
  const url = search 
    ? `/api/usuarios?search=${encodeURIComponent(search)}&all=true`
    : '/api/usuarios?all=true'
  
  try {
    const data = await fetchWithAuth(url)
    return data.usuarios || []
  } catch (error) {
    console.error("Erro ao buscar usuários:", error)
    return []
  }
}

// Criar novo usuário - PRECISA de autenticação de admin
export async function createUser(userData: User): Promise<User> {
  const token = getAuthToken()
  
  if (!token) {
    throw new Error("Você precisa estar autenticado para criar usuários")
  }

  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
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

  return data.usuario
}

// Deletar usuário
export async function deleteUser(userId: number): Promise<boolean> {
  await fetchWithAuth(`/api/usuarios/${userId}`, {
    method: 'DELETE',
  })

  return true
}