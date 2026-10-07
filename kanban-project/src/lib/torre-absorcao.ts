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

// ─── A OPERAÇÃO INTEIRA DO ADMIN MORA NA TORRE (30/09/2026) ─────────────────────────────────────────────────
// `/operacao` deixa de ser destino do ADMINISTRADOR: a página o leva à Torre traduzindo o que o link carregava
// (família, aba, tarefa). Os avisos JÁ GRAVADOS continuam funcionando — a tradução é feita na chegada em
// `/operacao` e no clique do sino, nunca reescrevendo o que está no banco. Não-admin: tudo igual ao de antes.

/** Quem tem acesso à Torre (a MESMA regra de `/torre`): administrador ou `operacao.distribuirTarefas`. (`/operacao` NÃO leva mais ninguém à Torre.) */
export function temAcessoATorre(tipoUsuario: string | null | undefined, pode: (chave: 'operacao.distribuirTarefas') => boolean): boolean {
  return tipoUsuario === 'admin' || pode('operacao.distribuirTarefas')
}

/** A aba da Operação (`?aba=`) → a aba interna de "Minha operação" (`?op=`). Sem `?aba=` válida: abre em A fazer (sem `op`). */
const ABAS_INTERNAS = ['aguardando', 'acompanhamento', 'familias', 'radar', 'feito'] as const

const inteiro = (v: string | null | undefined): string | null => (v && /^\d+$/.test(v) ? v : null)

/** Todo link que antes abria a janela "Foco da família" leva à PÁGINA do processo. */
const paginaDoProcesso = (processo: string): string => `/torre/processo/${processo}`

/**
 * `/operacao?...` → `/torre?...` PARA QUEM TEM ACESSO À TORRE. Preserva: `processo` (família → página do processo), `aba` (vira a aba interna de
 * "Minha operação", `op`), e a tarefa (`taskId` ou `tarefa` → drawer). Sem nada disso: a aba "Minha operação" (06/10/2026; antes: visão "Minhas" de Tarefas).
 */
export function destinoDaOperacaoParaAdmin(query: URLSearchParams | string): string {
  const q = typeof query === 'string' ? new URLSearchParams(query.replace(/^\?/, '')) : query
  const processo = inteiro(q.get('processo') ?? q.get('processoId'))
  const tarefa = inteiro(q.get('tarefa') ?? q.get('taskId'))
  if (processo && !tarefa) return paginaDoProcesso(processo)
  if (tarefa) {
    const destino = new URLSearchParams({ aba: 'tarefas', tarefa })
    if (processo) destino.set('processo', processo)
    return `/torre?${destino.toString()}`
  }
  // "MINHA OPERAÇÃO" SAIU DA TORRE (06/10/2026): é a tela de quem executa e fica em /operacao — sem redirecionar o administrador para a Torre.
  const op = q.get('aba') ?? ''
  return (ABAS_INTERNAS as readonly string[]).includes(op) ? `/operacao?aba=${op}` : '/operacao'
}

/**
 * O LINK DE UM AVISO, para quem é ADMIN. Aviso de família → página do processo; de tarefa → drawer da tarefa;
 * de distribuição → Sem responsável. Qualquer outro link (e TODO link de não-admin) volta como veio.
 */
export function linkDoAvisoParaAdmin(link: string | null | undefined, tipoUsuario: string | null | undefined): string | null {
  if (!link) return null
  if (tipoUsuario !== 'admin') return link
  const [caminho, qs = ''] = link.split('?')
  const q = new URLSearchParams(qs)
  if (caminho === '/operacao') return destinoDaOperacaoParaAdmin(q)
  if (caminho === '/operacao/distribuicao') {
    const processo = inteiro(q.get('processo'))
    return processo ? paginaDoProcesso(processo) : '/torre?aba=tarefas&visao=semdono'
  }
  if (caminho === '/tarefas') {
    const processo = inteiro(q.get('processo'))
    return processo ? paginaDoProcesso(processo) : '/torre?aba=tarefas'
  }
  // Aviso de tarefa/fase que apontava para o Kanban do processo (Central): tarefa → drawer; fase → página do processo.
  if (caminho === '/kanban' && q.get('tab') === 'central') {
    const processo = inteiro(q.get('processoId'))
    const tarefa = inteiro(q.get('taskId'))
    if (tarefa) return `/torre?aba=tarefas&tarefa=${tarefa}${processo ? `&processo=${processo}` : ''}`
    if (processo) return paginaDoProcesso(processo)
  }
  return link
}
