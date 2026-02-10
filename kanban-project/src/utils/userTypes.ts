export enum UserType {
  ADMIN = "admin",
  GERENTE = "gerente",
  ASSISTENTE = "assistente",
  ESTAGIARIO = "estagiario"
}

export const userTypeLabels = {
  [UserType.ADMIN]: "Administrador",
  [UserType.GERENTE]: "Gerente",
  [UserType.ASSISTENTE]: "Assistente",
  [UserType.ESTAGIARIO]: "Estagiário"
}