// src/app/api/genealogy/arvore/importar/route.ts
// ============================================================================
// IMPORTAR ÁRVORE A PARTIR DE UMA IMAGEM — print de árvore já montada.
//
// CONTRATO — uma rota, duas ações, porque a prévia é obrigatória: nada é
// gravado sem o operador ver e confirmar.
//
//   POST { acao: "analisar", arvoreId, imagemBase64, mimeType, textoComplementar? }
//     → 200 { extracao: ExtracaoArvore }        ← só lê, NÃO grava
//     → 501 { error, codigo: "EXTRACAO_NAO_IMPLEMENTADA" }  enquanto falta a chave
//
//   POST { acao: "confirmar", arvoreId, extracao }
//     → 201 { criadas: { pessoas, unioes }, mapaRefParaId }
//
// A extração revisada volta do cliente na confirmação: o operador pode ter
// corrigido um nome ou removido uma pessoa na prévia. O servidor grava o que
// recebe (validado), não o que leu — senão a prévia seria decorativa.
// ============================================================================
import { type NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verificarPermissao } from "@/src/lib/verificar-permissao"
import { dispararMaterializacaoPorArvore } from "@/src/services/genealogia/materializar-genealogia"
import { ExtracaoNaoImplementada, FalhaNaLeitura, obterExtrator } from "@/src/lib/genealogia/importar-arvore/extrair"
import type { ExtracaoArvore, PessoaExtraida, UniaoExtraida } from "@/src/lib/genealogia/importar-arvore/tipos"

export const maxDuration = 60

/** Data ISO → Date. Valor ausente, vazio ou inválido vira null (nunca "hoje"). */
function paraData(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

export async function POST(request: NextRequest) {
  const semPermissao = await verificarPermissao(request, "arvore.criar")
  if (semPermissao) return semPermissao

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }

  const acao = body.acao
  const arvoreId = Number(body.arvoreId)
  if (!Number.isInteger(arvoreId) || arvoreId <= 0) {
    return NextResponse.json({ error: "arvoreId é obrigatório" }, { status: 400 })
  }

  const arvore = await prisma.arvore.findUnique({ where: { id: arvoreId }, select: { id: true } })
  if (!arvore) return NextResponse.json({ error: "Árvore não encontrada" }, { status: 404 })

  // ── AÇÃO 1: ANALISAR — lê a imagem, não grava nada ────────────────────────
  if (acao === "analisar") {
    const imagemBase64 = texto(body.imagemBase64)
    const mimeType = texto(body.mimeType)
    if (!imagemBase64 || !mimeType) {
      return NextResponse.json({ error: "imagemBase64 e mimeType são obrigatórios" }, { status: 400 })
    }
    if (!/^image\/(png|jpe?g|webp)$/i.test(mimeType)) {
      return NextResponse.json({ error: "Formato aceito: PNG, JPEG ou WebP" }, { status: 400 })
    }

    try {
      const extracao = await obterExtrator()({
        imagemBase64,
        mimeType,
        textoComplementar: texto(body.textoComplementar),
      })
      return NextResponse.json({ extracao })
    } catch (e) {
      if (e instanceof ExtracaoNaoImplementada) {
        return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: 501 })
      }
      // `FalhaNaLeitura` já vem com a causa nomeada (imagem acima do limite,
      // resposta cortada pelo teto de tokens, credencial recusada). Trocar isso
      // por "Falha ao ler a imagem" obrigaria o operador a adivinhar.
      if (e instanceof FalhaNaLeitura) {
        return NextResponse.json({ error: e.message, codigo: e.codigo }, { status: 502 })
      }
      console.error("[importar-arvore] falha ao analisar:", e)
      return NextResponse.json({ error: "Falha ao ler a imagem" }, { status: 502 })
    }
  }

  // ── AÇÃO 2: CONFIRMAR — grava a extração revisada pelo operador ───────────
  if (acao === "confirmar") {
    const extracao = body.extracao as ExtracaoArvore | undefined
    const pessoas = Array.isArray(extracao?.pessoas) ? (extracao.pessoas as PessoaExtraida[]) : null
    const unioes = Array.isArray(extracao?.unioes) ? (extracao.unioes as UniaoExtraida[]) : []
    if (!pessoas || pessoas.length === 0) {
      return NextResponse.json({ error: "extracao.pessoas vazio — nada a gravar" }, { status: 400 })
    }

    const semNome = pessoas.filter((p) => !texto(p.nome))
    if (semNome.length) {
      return NextResponse.json({ error: `${semNome.length} pessoa(s) sem nome — corrija na prévia` }, { status: 400 })
    }
    const refs = new Set(pessoas.map((p) => p.ref))
    if (refs.size !== pessoas.length) {
      return NextResponse.json({ error: "há `ref` repetido na extração" }, { status: 400 })
    }

    try {
      // Tudo numa transação: uma árvore importada pela metade é pior que
      // nenhuma — o operador não teria como saber o que entrou.
      const resultado = await prisma.$transaction(async (tx) => {
        const mapa = new Map<string, number>()

        // 1ª passada: cria as pessoas SEM parentesco. O pai pode aparecer
        // depois do filho na lista, então ligar na criação exigiria ordenação
        // topológica — e um ciclo nos dados travaria a importação inteira.
        for (const p of pessoas) {
          const criada = await tx.pessoa.create({
            data: {
              nome: String(p.nome).trim(),
              sobrenome: texto(p.sobrenome),
              sexo: texto(p.sexo),
              data_nasc: paraData(p.data_nasc),
              local_nasc: texto(p.local_nasc),
              estado_nasc: texto(p.estado_nasc),
              pais_nasc: texto(p.pais_nasc),
              nacionalidade: texto(p.nacionalidade),
              data_obito: paraData(p.data_obito),
              // GOTCHA do modelo: `Pessoa` não tem coluna `local_obito`. O campo
              // "Local de Falecimento" da tela grava em `local_emigracao`
              // (arvore-genealogica-view.tsx), o motor lê a mesma coluna como
              // óbito quando não há `data_emigracao` (motor/eventos.ts) e a
              // sidebar faz `local_obito || local_emigracao`. A importação segue
              // a MESMA convenção — inventar uma coluna nova aqui deixaria o
              // dado invisível para as três telas que já sabem onde procurar.
              // A importação nunca grava `data_emigracao`, então não há como o
              // motor confundir este valor com emigração de verdade.
              local_emigracao: texto(p.local_obito),
              vivo: paraData(p.data_obito) ? false : true,
              numeroLinhagem: typeof p.numeroLinhagem === "number" ? p.numeroLinhagem : null,
              arvoreId,
              // requerente é definido só pelo vínculo com o Processo
              // (ProcessoRequerente), nunca por criação de Pessoa.
              requerente: "nao",
            },
            select: { id: true },
          })
          mapa.set(p.ref, criada.id)
        }

        // 2ª passada: liga pai/mãe, agora que todos os ids existem.
        for (const p of pessoas) {
          const paiId = p.paiRef ? mapa.get(p.paiRef) ?? null : null
          const maeId = p.maeRef ? mapa.get(p.maeRef) ?? null : null
          if (!paiId && !maeId) continue
          await tx.pessoa.update({
            where: { id: mapa.get(p.ref)! },
            data: { paiId, maeId },
          })
        }

        // 3ª passada: uniões. Referência quebrada é ignorada em silêncio? Não —
        // conta como aviso no retorno, para o operador saber o que não entrou.
        const unioesIgnoradas: string[] = []
        let unioesCriadas = 0
        for (const u of unioes) {
          const p1 = mapa.get(u.pessoa1Ref)
          const p2 = mapa.get(u.pessoa2Ref)
          if (!p1 || !p2) {
            unioesIgnoradas.push(`${u.pessoa1Ref}–${u.pessoa2Ref}`)
            continue
          }
          await tx.uniao.create({
            data: {
              pessoa1Id: p1,
              pessoa2Id: p2,
              data_inicio: paraData(u.data_inicio),
              local: texto(u.local),
              estado: texto(u.estado),
              pais: texto(u.pais),
              tipo: "casamento",
            },
          })
          unioesCriadas++
        }

        // `casado` é flag do motor: quem tem união entra como casado.
        const comUniao = new Set<number>()
        for (const u of unioes) {
          const p1 = mapa.get(u.pessoa1Ref)
          const p2 = mapa.get(u.pessoa2Ref)
          if (p1) comUniao.add(p1)
          if (p2) comUniao.add(p2)
        }
        if (comUniao.size) {
          await tx.pessoa.updateMany({ where: { id: { in: [...comUniao] } }, data: { casado: true } })
        }

        return {
          criadas: { pessoas: mapa.size, unioes: unioesCriadas },
          mapaRefParaId: Object.fromEntries(mapa),
          unioesIgnoradas,
        }
      })

      // Fora da transação, best-effort: nunca derruba uma importação já gravada.
      await dispararMaterializacaoPorArvore(arvoreId).catch(() => {})

      return NextResponse.json(resultado, { status: 201 })
    } catch (e) {
      console.error("[importar-arvore] falha ao gravar:", e)
      return NextResponse.json({ error: "Falha ao gravar a árvore importada" }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'acao deve ser "analisar" ou "confirmar"' }, { status: 400 })
}
