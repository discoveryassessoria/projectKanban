// src/app/api/operacao/atribuiveis/route.ts
// ============================================================================
// QUEM PODE RECEBER TRABALHO.
//
//   GET /api/operacao/atribuiveis
//
// A lista do seletor de "Atribuir" não é "todo mundo do cadastro": é quem tem
// permissão de EXECUTAR tarefa (`tarefas.iniciar_concluir`), resolvida pelo
// sistema real — perfil + permissões nominais —, nunca por `tipo === "admin"`
// escrito na tela.
//
// Isso importa porque atribuir a quem não pode executar cria uma tarefa que
// nasce travada: aparece na fila de alguém que não consegue movê-la, e o
// bloqueio só é descoberto quando o prazo já correu.
//
// A carga vem da MESMA projeção canônica que a operação usa (`cargaPorResponsavel`).
// Não é recomendação nem balanceamento — é informação, para quem decide decidir.
// ============================================================================
import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { calcularPermissoes, temPermissao, type MapaPermissoes } from '@/src/lib/permissoes'
import { cargaPorResponsavel } from '@/lib/operacional/tarefa-projecoes'

export async function GET(request: NextRequest) {
  // Só quem distribui vê a lista de para-quem-distribuir.
  const erro = await verificarPermissao(request, 'tarefas.editar')
  if (erro) return erro

  const usuarios = await prisma.usuario.findMany({
    select: { id: true, nome: true, tipo: true, permissoesCustom: true, perfil: { select: { permissoes: true } } },
    orderBy: { nome: 'asc' },
  })

  const carga = new Map((await cargaPorResponsavel()).map((c) => [c.responsavelId, c]))

  const elegiveis = usuarios
    .filter((u) =>
      temPermissao(
        calcularPermissoes(u.tipo, u.perfil?.permissoes as MapaPermissoes | null, u.permissoesCustom as MapaPermissoes | null),
        'tarefas.iniciar_concluir',
      ),
    )
    .map((u) => ({
      id: u.id,
      nome: u.nome,
      // Carga atual, sem juízo de valor: quantas tarefas ativas e quantas já
      // estouraram o prazo. Quem distribui olha e decide.
      tarefasAtivas: carga.get(u.id)?.tarefasAtivas ?? 0,
      atrasadas: carga.get(u.id)?.atrasadas ?? 0,
    }))

  return NextResponse.json({ total: elegiveis.length, funcionarios: elegiveis })
}
