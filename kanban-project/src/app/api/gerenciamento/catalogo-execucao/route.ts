// O QUE O ADMINISTRADOR PODE ESCOLHER — efeitos, executores e tipos de campo.
//
// A tela precisa oferecer efeitos e executores REAIS; oferecer uma lista escrita à
// mão no frontend traria de volta exatamente o problema que este trabalho resolve.
// Aqui o servidor devolve o catálogo que a publicação usa para validar.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verificarPermissao } from '@/src/lib/verificar-permissao'
import { CATALOGO_DE_EFEITOS, efeitosDaFase, COMPETENCIAS } from '@/src/lib/motor/catalogo-de-efeitos'
import { REGISTRO_DE_EXECUTORES, TIPOS_DE_CAMPO } from '@/src/lib/motor/registro-de-executores'

export async function GET(request: NextRequest) {
  const erro = await verificarPermissao(request, 'usuarios.gerenciar')
  if (erro) return erro
  const phaseKey = request.nextUrl.searchParams.get('phaseKey')

  let permitidos: string[] | null = null
  if (phaseKey) {
    const fase = await prisma.catalogoFase.findUnique({ where: { phaseKey }, select: { efeitosPermitidos: true } })
    permitidos = efeitosDaFase(phaseKey, fase?.efeitosPermitidos ?? null)
  }

  return NextResponse.json({
    efeitos: CATALOGO_DE_EFEITOS.map((e) => ({
      ...e, permitidoNestaFase: permitidos ? permitidos.includes(e.key) : true,
    })),
    competencias: Object.values(COMPETENCIAS),
    executores: Object.values(REGISTRO_DE_EXECUTORES).map((x) => ({
      key: x.key, label: x.label, campos: x.campos,
      efeitos: x.efeitos === '*' ? CATALOGO_DE_EFEITOS.map((e) => e.key) : x.efeitos,
      acoesCadastradas: x.acoesCadastradas, checklistCadastrado: x.checklistCadastrado,
      // AS CAPACIDADES INTEIRAS, não um recorte. A tela precisa saber se o executor
      // desenha canal, evidência, espera externa e condição para não oferecer ao
      // administrador um cadastro que nunca vai aparecer para o operador.
      suportaCanais: x.suportaCanais, suportaEvidencia: x.suportaEvidencia,
      suportaEsperaExterna: x.suportaEsperaExterna, suportaCondicoes: x.suportaCondicoes,
    })),
    tiposDeCampo: TIPOS_DE_CAMPO,
    canais: await prisma.canalOperacional.findMany({
      where: { ativo: true }, orderBy: [{ ordem: 'asc' }],
      // AS EXIGÊNCIAS DO CATÁLOGO VÊM JUNTO: o passo pode exigir MAIS que o canal,
      // nunca menos, e o administrador só sabe o que está acrescentando se vir o que
      // já é exigido de origem.
      select: {
        key: true, label: true, protocoloObrigatorio: true, anexoObrigatorioLabel: true,
        rastreioObrigatorio: true, observacaoObrigatoria: true,
      },
    }),
  })
}
