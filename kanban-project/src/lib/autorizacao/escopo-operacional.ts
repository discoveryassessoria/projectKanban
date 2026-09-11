// src/lib/autorizacao/escopo-operacional.ts
// ============================================================================
// ESCOPO OPERACIONAL — a fronteira entre "ADMIN vê tudo" e "operacional vê só
// o próprio trabalho". Uma função por grão (tarefa/passo/processo/documento),
// reunidas AQUI para nunca serem escritas duas vezes com semânticas
// diferentes — quem precisa filtrar por usuário importa daqui, nunca escreve
// o próprio `where`.
//
// REGRA (decisão do usuário, 10/09/2026 — CORRIGIDA em 10/09/2026, mesmo dia):
//   ADMIN (tipo==='admin')  → sem filtro — visão global autorizada, em tudo.
//
//   PROCESSO/FAMÍLIA != TAREFA. Visibilidade de PROCESSO/FAMÍLIA NÃO depende
//   de ownership de tarefa — segue a permissão normal do módulo (quem tem
//   `processos.ver` vê o mesmo universo de processos que o admin vê, cada um
//   dentro do que sua permissão de módulo já autoriza). A primeira versão
//   desta regra (mesmo dia) filtrava Processo por
//   `tarefas.some.responsavelId = usuario` — a instrução corrigiu isso
//   explicitamente: "processo WHERE tarefas.some.responsavelId = usuario...
//   essa condição não pertence ao domínio Processo". Um processo/família
//   continua existindo, visível, mesmo sem NENHUMA tarefa atribuída a
//   ninguém — responsabilidade é propriedade da TAREFA, não pré-condição de
//   o PROCESSO aparecer.
//
//   TAREFA/PASSO (a unidade operacional) → só o que tem responsavelId = o
//   próprio usuário. Tarefa/passo SEM responsável NÃO pertence a ninguém até
//   ser atribuída — por isso o operacional NÃO inclui `responsavelId: null`
//   (esse era o bug original: a fila "sem responsável" da empresa inteira
//   vazava pra qualquer operacional).
//
// NENHUMA tabela nova, NENHUMA permissão nova: a mesma responsabilidade
// canônica de Tarefa.responsavelId/PhaseWorkflowStepInstance.responsavelId
// que a Central Operacional e /api/tarefas já usam decide o escopo pessoal —
// Processo/Documento seguem a permissão de módulo, não essa responsabilidade.
// ============================================================================
import type { Prisma } from "@prisma/client"

export interface UsuarioEscopo {
  userId: number
  tipo: string
}

export const ehAdmin = (usuario: UsuarioEscopo): boolean => usuario.tipo === "admin"

/** Tarefa: admin vê tudo; operacional só a SUA — nunca a sem responsável. */
export function escopoTarefa(usuario: UsuarioEscopo): Prisma.TarefaWhereInput {
  return ehAdmin(usuario) ? {} : { responsavelId: usuario.userId }
}

/** Passo do workflow interno: mesma regra da tarefa. */
export function escopoPasso(usuario: UsuarioEscopo): Prisma.PhaseWorkflowStepInstanceWhereInput {
  return ehAdmin(usuario) ? {} : { responsavelId: usuario.userId }
}

/**
 * Processo: SEM filtro por responsável, pra admin E pra operacional. Quem
 * decide se Processo/Família aparecem é a permissão de módulo
 * (`processos.ver`, já verificada por quem chama), nunca ownership de
 * tarefa — ver a correção datada no cabeçalho do arquivo. `usuario` fica no
 * parâmetro só pra manter a mesma assinatura de todo escopo daqui (o
 * chamador nunca precisa saber que este em particular não filtra).
 */
export function escopoProcesso(_usuario: UsuarioEscopo): Prisma.ProcessoWhereInput {
  return {}
}

/** Evento (agenda): admin vê tudo; operacional só os que é o responsável. */
export function escopoEvento(usuario: UsuarioEscopo): Prisma.EventoWhereInput {
  return ehAdmin(usuario) ? {} : { responsavelId: usuario.userId }
}

/**
 * Documento: mesma regra de Processo — segue permissão de módulo, não
 * ownership de tarefa (documento é do domínio Processo/Pessoa, nunca da
 * tarefa de quem está com ele no momento).
 */
export function escopoDocumento(_usuario: UsuarioEscopo): Prisma.DocumentoWhereInput {
  return {}
}
