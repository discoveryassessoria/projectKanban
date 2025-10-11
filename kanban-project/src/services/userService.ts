interface User {
  id?: number
  nome: string
  email: string
  senha?: string
  tipo: string
}

interface UserResponse {
  message?: string
  usuario?: User
  usuarios?: User[]
  error?: string
}

// Função auxiliar para obter o token
function getAuthToken(): string | null {
  return localStorage.getItem("authToken")
}

// Função auxiliar para fazer requisições autenticadas
async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const token = getAuthToken()
  
  if (!token) {
    throw new Error("Usuário não autenticado")
  }

  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    ...options.headers,
  }

  const response = await fetch(url, { ...options, headers })
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || "Erro na requisição")
  }

  return data
}

// Buscar todos os usuários
export async function getUsers(search?: string): Promise<User[]> {
  try {
    const url = search 
      ? `/api/usuarios?search=${encodeURIComponent(search)}&all=true`
      : '/api/usuarios?all=true'
    
    const data = await fetchWithAuth(url)
    return data.usuarios || []
  } catch (error) {
    console.error("Erro ao buscar usuários:", error)
    throw error
  }
}

// Criar novo usuário
export async function createUser(userData: User): Promise<User> {
  try {
    const data = await fetchWithAuth('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    })
    return data.user
  } catch (error) {
    console.error("Erro ao criar usuário:", error)
    throw error
  }
}

// Atualizar usuário existente
export async function updateUser(userId: number, userData: Partial<User>): Promise<User> {
  try {
    const data = await fetchWithAuth(`/api/usuarios/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    })
    return data.usuario
  } catch (error) {
    console.error("Erro ao atualizar usuário:", error)
    throw error
  }
}

// Deletar usuário
export async function deleteUser(userId: number): Promise<void> {
  try {
    await fetchWithAuth(`/api/usuarios/${userId}`, {
      method: 'DELETE',
    })
  } catch (error) {
    console.error("Erro ao deletar usuário:", error)
    throw error
  }
}
