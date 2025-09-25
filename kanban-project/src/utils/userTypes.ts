export enum UserType {
  ADMIN = "admin",
  USUARIO = "usuario",
  GESTOR = "gestor"
}

export const userTypeLabels = {
  [UserType.ADMIN]: "Administrador",
  [UserType.USUARIO]: "Usuário",
  [UserType.GESTOR]: "Gestor"
}