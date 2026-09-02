// GET /api/relatorios/meta[?dominio=]
//
// O QUE SE PODE PERGUNTAR. A tela não sabe nada de negócio: ela desenha o que o
// domínio declarou — filtros, agrupamentos, colunas, ordenações e as visões
// prontas. Filtro novo aparece na interface sem uma linha de front.
//
// SOMENTE LEITURA.

import { NextResponse } from "next/server"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { DOMINIOS, dominioPorChave } from "@/src/lib/relatorios/motor/registro"
import { nacionalidadesOfertadas } from "@/src/lib/relatorios/motor/opcoes"

const resumo = (d: (typeof DOMINIOS)[number]) => ({
  key: d.key, rotulo: d.rotulo, descricao: d.descricao, grain: d.grain,
  ordem: d.ordem, grupo: d.grupo, permissao: d.permissao, aceitaNacionalidade: d.aceitaNacionalidade,
})

export async function GET(request: Request) {
  const erro = await verificarPermissao(request, "processos.ver_paginas")
  if (erro) return erro
  try {
    const chave = new URL(request.url).searchParams.get("dominio")

    // A LISTA DE NACIONALIDADES É A DA OFERTA, não a do mapa-múndi. Um país só
    // entra aqui se existir um Tipo de Processo ativo apontando para ele.
    const nacionalidades = await nacionalidadesOfertadas()

    if (!chave) {
      return NextResponse.json({
        dominios: [...DOMINIOS].sort((a, b) => a.ordem - b.ordem).map(resumo),
        nacionalidades,
      })
    }

    const d = dominioPorChave(chave)
    if (!d) return NextResponse.json({ error: "Domínio não encontrado." }, { status: 404 })

    // O grain é resolvido NO CONTEXTO: a mesma tela diz "1 protocolo do
    // processo" na Itália e "1 protocolo individual" na Espanha, porque a
    // cardinalidade vem do cadastro da modalidade legal.
    const nac = new URL(request.url).searchParams.get("nacionalidade")
    const grain = d.grainNoContexto ? await d.grainNoContexto(nac) : d.grain

    return NextResponse.json({
      dominio: { ...resumo(d), grain },
      nacionalidades,
      filtros: d.filtros.map((f) => ({
        key: f.key, rotulo: f.rotulo, tipo: f.tipo, descricao: f.descricao ?? null,
        // Catálogo fechado vai junto; cadastro é buscado sob demanda em /opcoes,
        // porque a lista é grande e muda enquanto a tela está aberta.
        opcoes: f.opcoes?.tipo === "catalogo" ? f.opcoes.valores : null,
        fonte: f.opcoes?.tipo === "cadastro" ? f.opcoes.chave : null,
      })),
      agrupamentos: d.agrupamentos.map((a) => ({ key: a.key, rotulo: a.rotulo })),
      colunas: d.colunas.map((c) => ({ key: c.key, rotulo: c.rotulo, alinhamento: c.alinhamento ?? null })),
      ordenacoes: d.ordenacoes.map((o) => ({ key: o.key, rotulo: o.rotulo })),
      colunasIniciais: d.colunasIniciais,
      filtrosPrincipais: d.filtrosPrincipais,
      ordenacaoPadrao: d.ordenacaoPadrao,
      visoesDoSistema: d.visoesDoSistema.map((v) => ({ key: v.key, nome: v.nome, spec: { ...v.spec, dominio: d.key } })),
    })
  } catch (e) {
    console.error("GET relatorios/meta", e)
    return NextResponse.json({ error: "Erro ao carregar o catálogo de relatórios." }, { status: 500 })
  }
}
