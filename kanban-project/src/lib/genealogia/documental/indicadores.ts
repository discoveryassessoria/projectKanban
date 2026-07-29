// src/lib/genealogia/documental/indicadores.ts
//
// INDICADOR DOCUMENTAL CONSUMIDO — não reimplementado.
//
// Constituição: documentos, necessidades, pendências, versões, validações e
// ciclo de vida documental pertencem EXCLUSIVAMENTE ao Sistema Documental. A
// árvore só consome indicador, vínculo e atalho contextual.
//
// O que este módulo faz: recebe a resposta do endpoint OFICIAL de necessidades
// (`GET /api/processos/:id/necessidades`) e a projeta por sujeito (pessoa ou
// união). Ele não decide o que é obrigatório, não deriva status, não cria nem
// altera nada — apenas AGRUPA o que o Sistema Documental já decidiu.
//
// O que ele substitui: até aqui a árvore lia `Pessoa.documentos` (o Documento
// cru) e pintava semáforo por tipo de documento no cartão. Isso era regra
// documental morando dentro da árvore — duas fontes para a mesma verdade.

/** Status oficial de uma necessidade. Espelha o enum do Sistema Documental. */
export type StatusNecessidade =
  | "PENDENTE"
  | "EM_ATENDIMENTO"
  | "ATENDIDA"
  | "NAO_LOCALIZADA"
  | "DISPENSADA"

export type Obrigatoriedade = "OBRIGATORIA" | "OPCIONAL"

/** Forma mínima consumida do endpoint oficial. Campos extras são ignorados. */
export interface NecessidadeOficial {
  id: number
  pessoaId?: number | null
  uniaoId?: number | null
  status: StatusNecessidade
  obrigatoriedade: Obrigatoriedade
  ciclo?: number
  itemCatalogo?: { id: number; code?: string | null; name?: string | null } | null
  _count?: { documentos?: number } | null
}

/**
 * Situação documental de um sujeito, na linguagem do Sistema Documental.
 * Nenhum campo é inventado aqui: cada número é uma contagem de status oficial.
 */
export interface IndicadorDocumental {
  /** Total de necessidades obrigatórias — o denominador do dossiê. */
  necessarias: number
  atendidas: number
  emAtendimento: number
  pendentes: number
  naoLocalizadas: number
  dispensadas: number
  /** Necessidades opcionais, contadas à parte para não distorcer o progresso. */
  opcionais: number
  /** 0..100 sobre as obrigatórias não dispensadas. null quando não há exigência. */
  progresso: number | null
  /** Estado-resumo para o selo do cartão. */
  situacao: SituacaoDocumental
}

export type SituacaoDocumental =
  | "sem_exigencia"   // nada exigido para este sujeito
  | "completo"        // todas as obrigatórias atendidas ou dispensadas
  | "em_andamento"    // há alguma em atendimento
  | "pendente"        // há obrigatória ainda não iniciada
  | "bloqueado"       // há obrigatória marcada como não localizada

export const ROTULO_SITUACAO: Record<SituacaoDocumental, string> = {
  sem_exigencia: "Sem exigência documental",
  completo: "Documentação completa",
  em_andamento: "Documentação em andamento",
  pendente: "Documentação pendente",
  bloqueado: "Documento não localizado",
}

const VAZIO: IndicadorDocumental = {
  necessarias: 0,
  atendidas: 0,
  emAtendimento: 0,
  pendentes: 0,
  naoLocalizadas: 0,
  dispensadas: 0,
  opcionais: 0,
  progresso: null,
  situacao: "sem_exigencia",
}

export function indicadorVazio(): IndicadorDocumental {
  return { ...VAZIO }
}

function classificar(i: IndicadorDocumental): SituacaoDocumental {
  if (i.necessarias === 0) return "sem_exigencia"
  if (i.naoLocalizadas > 0) return "bloqueado"
  if (i.pendentes > 0) return "pendente"
  if (i.emAtendimento > 0) return "em_andamento"
  return "completo"
}

function acumular(alvo: IndicadorDocumental, n: NecessidadeOficial): void {
  if (n.obrigatoriedade === "OPCIONAL") {
    alvo.opcionais++
    return
  }
  alvo.necessarias++
  switch (n.status) {
    case "ATENDIDA":
      alvo.atendidas++
      break
    case "EM_ATENDIMENTO":
      alvo.emAtendimento++
      break
    case "NAO_LOCALIZADA":
      alvo.naoLocalizadas++
      break
    case "DISPENSADA":
      alvo.dispensadas++
      break
    default:
      alvo.pendentes++
  }
}

function fechar(i: IndicadorDocumental): IndicadorDocumental {
  // Dispensada conta como resolvida: o Sistema Documental já decidiu que aquela
  // exigência não se aplica. Tratá-la como pendência faria o dossiê nunca
  // fechar e a árvore contradizer o módulo dono da regra.
  const resolvidas = i.atendidas + i.dispensadas
  i.progresso = i.necessarias > 0 ? Math.round((resolvidas / i.necessarias) * 100) : null
  i.situacao = classificar(i)
  return i
}

export interface ProjecaoDocumental {
  porPessoa: Map<number, IndicadorDocumental>
  porUniao: Map<number, IndicadorDocumental>
  /** Consolidado do processo inteiro. */
  total: IndicadorDocumental
}

/**
 * Projeta a lista oficial de necessidades por sujeito.
 * Necessidade sem sujeito (processo como um todo) entra apenas no consolidado.
 */
export function projetarIndicadores(
  necessidades: NecessidadeOficial[] | null | undefined,
): ProjecaoDocumental {
  const porPessoa = new Map<number, IndicadorDocumental>()
  const porUniao = new Map<number, IndicadorDocumental>()
  const total = indicadorVazio()

  for (const n of necessidades || []) {
    if (!n || typeof n.status !== "string") continue
    acumular(total, n)

    if (n.pessoaId != null) {
      let alvo = porPessoa.get(n.pessoaId)
      if (!alvo) {
        alvo = indicadorVazio()
        porPessoa.set(n.pessoaId, alvo)
      }
      acumular(alvo, n)
    } else if (n.uniaoId != null) {
      let alvo = porUniao.get(n.uniaoId)
      if (!alvo) {
        alvo = indicadorVazio()
        porUniao.set(n.uniaoId, alvo)
      }
      acumular(alvo, n)
    }
  }

  porPessoa.forEach(fechar)
  porUniao.forEach(fechar)
  fechar(total)

  return { porPessoa, porUniao, total }
}

/**
 * Indicador de uma pessoa somando o que é dela e o que é das uniões dela.
 * A certidão de casamento é exigida da UNIÃO, mas quem a busca pensa nela como
 * pendência das duas pessoas — o cartão precisa refletir isso.
 */
export function indicadorDaPessoa(
  projecao: ProjecaoDocumental,
  pessoaId: number,
  uniaoIds: number[],
): IndicadorDocumental {
  const base = projecao.porPessoa.get(pessoaId)
  if (!base && uniaoIds.length === 0) return indicadorVazio()

  const soma = base ? { ...base } : indicadorVazio()
  for (const uid of uniaoIds) {
    const u = projecao.porUniao.get(uid)
    if (!u) continue
    soma.necessarias += u.necessarias
    soma.atendidas += u.atendidas
    soma.emAtendimento += u.emAtendimento
    soma.pendentes += u.pendentes
    soma.naoLocalizadas += u.naoLocalizadas
    soma.dispensadas += u.dispensadas
    soma.opcionais += u.opcionais
  }
  return fechar(soma)
}
