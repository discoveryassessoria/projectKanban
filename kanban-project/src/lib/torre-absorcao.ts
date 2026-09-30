// src/lib/torre-absorcao.ts
// ============================================================================
// ABSORÇÃO DAS TELAS ANTIGAS PELA TORRE — Bloco J5 (30/09/2026).
//
// "Tarefas e Projetos" e "Distribuição" passam a levar à Torre — SÓ QUEM É ADMINISTRADOR. Quem não é
// (a Daniela, por exemplo, que usa /operacao/distribuicao e NÃO tem acesso à Torre) continua na tela
// atual, funcionando como hoje. Nada é apagado: as duas telas seguem existindo, com o mesmo código.
//
// A decisão vive AQUI, numa função pura — as duas páginas só a consultam, e o teste prova as duas metades
// (admin vai / não-admin fica) sem depender de navegador.
// ============================================================================

export type RotaAbsorvida = '/tarefas' | '/operacao/distribuicao'

/** Aba/filtro da Torre que corresponde a cada tela antiga. */
export const DESTINO_NA_TORRE: Record<RotaAbsorvida, string> = {
  // Tarefas e Projetos: a visão gerencial da tarefa → a aba Tarefas.
  '/tarefas': '/torre?aba=tarefas',
  // Distribuição: decidir de quem é o trabalho sem dono → a aba Tarefas já filtrada por "Sem responsável" (onde estão o
  // Atribuir, o lote e a sugestão), e a aba Equipe fica a um clique para a capacidade.
  '/operacao/distribuicao': '/torre?aba=tarefas&kpi=semdono',
}

/** Para onde levar este usuário ao abrir a rota antiga? `null` = ficar onde está (não-admin). */
export function destinoDaAbsorcao(rota: RotaAbsorvida, tipoUsuario: string | null | undefined): string | null {
  return tipoUsuario === 'admin' ? DESTINO_NA_TORRE[rota] : null
}
