// src/app/api/operacao/visao-global/route.ts
// ============================================================================
// A LEITURA GERENCIAL — a operação inteira, para Lista e Kanban.
//
//   GET /api/operacao/visao-global?responsavel=7&fase=EMISSAO&atrasadas=1&busca=ademir
//
// Uma rota, uma consulta, duas telas. Lista e Kanban NÃO têm cada uma a sua
// leitura: se tivessem, um dia discordariam sobre a mesma tarefa, e o gestor
// não teria como saber qual das duas está mentindo.
//
// Rota de LEITURA: não escreve nada. Quem muda a tarefa continua sendo
// `POST /api/tarefas/{id}/comando` — inclusive quando a mudança nasce de
// arrastar um card.
//
// ─── ESCOPO ─────────────────────────────────────────────────────────────────
// Ver a operação inteira é ato de GESTÃO: exige `tarefas.editar`, a mesma
// permissão de "Sem responsável". Quem só executa continua com a Minha Fila,
// que já é a sua visão do mundo — e é o backend que decide isso, não a tela.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import type { PrioridadeTarefa, StatusTarefa } from '@prisma/client'
import { verificarPermissao, extrairUsuarioComPermissoes } from '@/src/lib/verificar-permissao'
import {
  visaoGerencial,
  indicadoresGerenciais,
  facetasGerenciais,
  type ColunaKanban,
  type FiltrosGerenciais,
} from '@/lib/operacional/tarefa-projecoes'

const COLUNAS: ColunaKanban[] = [
  'SEM_RESPONSAVEL', 'A_FAZER', 'EM_ANDAMENTO', 'AGUARDANDO_TERCEIRO', 'BLOQUEADA', 'CONCLUIDA',
]

const inteiro = (v: string | null): number | null => {
  const n = Number(v)
  return v != null && Number.isInteger(n) && n > 0 ? n : null
}
const bandeira = (v: string | null) => v === '1' || v === 'true'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'tarefas.editar')
  if (erro) return erro

  const usuario = await extrairUsuarioComPermissoes(request)
  if (!usuario) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  const p = request.nextUrl.searchParams
  const colunaPedida = p.get('coluna')
  const filtros: FiltrosGerenciais = {
    responsavelId: inteiro(p.get('responsavel')),
    semResponsavel: bandeira(p.get('semResponsavel')),
    faseMacroKey: p.get('fase') || null,
    status: (p.getAll('status').filter(Boolean) as StatusTarefa[]) || undefined,
    coluna: colunaPedida && (COLUNAS as string[]).includes(colunaPedida) ? (colunaPedida as ColunaKanban) : null,
    prioridade: (p.getAll('prioridade').filter(Boolean) as PrioridadeTarefa[]) || undefined,
    atrasadas: bandeira(p.get('atrasadas')),
    venceHoje: bandeira(p.get('venceHoje')),
    processoId: inteiro(p.get('processo')),
    pessoaId: inteiro(p.get('pessoa')),
    busca: p.get('busca'),
    incluirEncerradas: bandeira(p.get('incluirEncerradas')),
    pagina: inteiro(p.get('pagina')) ?? 1,
    porPagina: inteiro(p.get('porPagina')) ?? 300,
  }

  const agora = new Date()
  // Os indicadores contam o universo dos MESMOS filtros, menos os de recorte
  // (atraso, vence hoje, coluna) — senão o número clicável mostraria sempre a
  // contagem do recorte já aplicado, e clicar nele nunca mudaria nada.
  const [pagina, indicadores, facetas] = await Promise.all([
    visaoGerencial(filtros, agora),
    indicadoresGerenciais(filtros, agora),
    facetasGerenciais(agora),
  ])

  return NextResponse.json({ ...pagina, indicadores, facetas })
}
