// src/lib/genealogia/motor/regras/cronologia.ts
//
// Conflitos cronológicos e biológicos. Toda regra aqui é DETERMINÍSTICA e
// explicável: o operador precisa saber por que a árvore acusou o erro, senão
// ele ignora o alerta. Nada de "score misterioso".

import type { GrafoGenealogico } from "../grafo"
import type { Insight } from "../tipos"
import { anosEntre, anoDe, diasEntre, formatarData, nomeCompleto, tsDe } from "../texto"

// Limites biológicos/documentais aceitos em genealogia profissional.
const IDADE_MIN_MAE = 12
const IDADE_MIN_PAI = 13
const IDADE_MAX_MAE = 52
const IDADE_MAX_PAI = 78
const IDADE_MAX_VIDA = 110
const IDADE_MIN_CASAMENTO = 12
const GESTACAO_MAX_DIAS = 300 // filho póstumo legítimo
const INTERVALO_MIN_IRMAOS_DIAS = 250 // menos que isso só se forem gêmeos

export function analisarCronologia(g: GrafoGenealogico): Insight[] {
  const out: Insight[] = []
  const anoAtual = new Date().getUTCFullYear()
  const nome = (id: number) => {
    const p = g.pessoa(id)
    return p ? nomeCompleto(p) : `#${id}`
  }

  const add = (i: Omit<Insight, "peso"> & { peso?: number }) => {
    out.push({ ...i, peso: i.peso ?? pesoPadrao(i.severidade) })
  }

  for (const p of g.pessoas) {
    const nasc = p.data_nasc
    const obito = p.data_obito
    const anoNasc = anoDe(nasc)
    const anoObito = anoDe(obito)

    // 1. Óbito antes do nascimento
    if (nasc && obito) {
      const dias = diasEntre(nasc, obito)
      if (dias != null && dias < 0) {
        add({
          id: `cron-obito-antes-${p.id}`,
          categoria: "conflito",
          severidade: "critico",
          titulo: `${nomeCompleto(p)} — óbito anterior ao nascimento`,
          explicacao: `Nascimento ${formatarData(nasc)} e óbito ${formatarData(obito)}. Uma das duas datas está trocada ou digitada errado.`,
          acao: "Conferir a certidão e corrigir a data invertida.",
          pessoaIds: [p.id],
          confianca: 1,
        })
      } else if (dias != null) {
        const idade = dias / 365.2425
        if (idade > IDADE_MAX_VIDA) {
          add({
            id: `cron-longevidade-${p.id}`,
            categoria: "conflito",
            severidade: "alto",
            titulo: `${nomeCompleto(p)} — ${Math.floor(idade)} anos de vida`,
            explicacao: `Idade acima de ${IDADE_MAX_VIDA} anos. Normalmente indica erro de século em uma das datas (ex.: 1878 lido como 1778).`,
            acao: "Revisar o ano de nascimento e de óbito na fonte original.",
            pessoaIds: [p.id],
            confianca: 0.9,
          })
        }
      }
    }

    // 2. Datas no futuro
    for (const [campo, valor, rotulo] of [
      ["data_nasc", nasc, "nascimento"],
      ["data_obito", obito, "óbito"],
      ["data_chegada", p.data_chegada, "chegada"],
      ["data_emigracao", p.data_emigracao, "emigração"],
    ] as const) {
      const ano = anoDe(valor)
      if (ano != null && ano > anoAtual) {
        add({
          id: `cron-futuro-${campo}-${p.id}`,
          categoria: "conflito",
          severidade: "alto",
          titulo: `${nomeCompleto(p)} — data de ${rotulo} no futuro`,
          explicacao: `A data de ${rotulo} (${formatarData(valor)}) é posterior a hoje.`,
          acao: "Corrigir a data.",
          pessoaIds: [p.id],
          confianca: 1,
        })
      }
    }

    // 3. Pessoa marcada como viva com óbito registrado (ou vice-versa)
    if (p.vivo === true && obito) {
      add({
        id: `cron-vivo-com-obito-${p.id}`,
        categoria: "conflito",
        severidade: "medio",
        titulo: `${nomeCompleto(p)} — marcada como viva, mas tem data de óbito`,
        explicacao: "O status vital contradiz a data de óbito registrada.",
        acao: "Marcar como falecida ou remover a data de óbito.",
        pessoaIds: [p.id],
        confianca: 1,
      })
    }
    // Só alerta quem realmente está marcado como vivo: ter data de óbito já
    // define a pessoa como falecida, mesmo que a flag `vivo` não tenha sido
    // desmarcada no cadastro (caso comum em importação).
    if (p.vivo !== false && !obito && anoNasc != null && anoAtual - anoNasc > IDADE_MAX_VIDA) {
      add({
        id: `cron-vivo-improvavel-${p.id}`,
        categoria: "conflito",
        severidade: "medio",
        titulo: `${nomeCompleto(p)} — viva com mais de ${IDADE_MAX_VIDA} anos`,
        explicacao: `Nascida em ${anoNasc} e ainda marcada como viva.`,
        acao: "Registrar o óbito ou revisar o ano de nascimento.",
        pessoaIds: [p.id],
        confianca: 0.85,
      })
    }

    // 4. Sequência migratória
    const cadeia: Array<[string, unknown, string]> = [
      ["nascimento", nasc, "nasceu"],
      ["emigração", p.data_emigracao, "emigrou"],
      ["chegada", p.data_chegada, "chegou"],
      ["naturalização", p.data_naturalizacao, "naturalizou-se"],
    ]
    for (let i = 0; i < cadeia.length - 1; i++) {
      for (let j = i + 1; j < cadeia.length; j++) {
        const [rotA, valA] = cadeia[i]
        const [rotB, valB] = cadeia[j]
        const d = diasEntre(valA as never, valB as never)
        if (d != null && d < 0) {
          add({
            id: `cron-ordem-${rotA}-${rotB}-${p.id}`,
            categoria: "conflito",
            severidade: rotA === "nascimento" ? "critico" : "alto",
            titulo: `${nomeCompleto(p)} — ${rotB} antes de ${rotA}`,
            explicacao: `A data de ${rotB} (${formatarData(valB as never)}) é anterior à de ${rotA} (${formatarData(valA as never)}).`,
            acao: "Revisar a ordem cronológica dos eventos migratórios.",
            pessoaIds: [p.id],
            confianca: 0.95,
          })
        }
      }
    }

    // 5. Naturalização após óbito — crítico para cidadania (define se transmitiu)
    if (obito && p.data_naturalizacao) {
      const d = diasEntre(obito, p.data_naturalizacao)
      if (d != null && d > 0) {
        add({
          id: `cron-natz-pos-obito-${p.id}`,
          categoria: "conflito",
          severidade: "critico",
          titulo: `${nomeCompleto(p)} — naturalização depois do óbito`,
          explicacao: `Naturalização em ${formatarData(p.data_naturalizacao)}, posterior ao óbito em ${formatarData(obito)}. A data de naturalização decide se houve ou não transmissão do direito — não pode estar errada.`,
          acao: "Confirmar na certidão negativa/positiva de naturalização.",
          pessoaIds: [p.id],
          confianca: 1,
        })
      }
    }

    // 6. Relação pai/mãe → filho
    for (const [parenteId, papel, idadeMin, idadeMax] of [
      [p.paiId, "pai", IDADE_MIN_PAI, IDADE_MAX_PAI],
      [p.maeId, "mãe", IDADE_MIN_MAE, IDADE_MAX_MAE],
    ] as const) {
      if (parenteId == null) continue
      const parente = g.pessoa(parenteId)
      if (!parente) continue

      const idadeNoParto = anosEntre(parente.data_nasc, nasc)
      if (idadeNoParto != null) {
        if (idadeNoParto < 0) {
          add({
            id: `cron-parente-mais-novo-${p.id}-${parenteId}`,
            categoria: "conflito",
            severidade: "critico",
            titulo: `${nomeCompleto(parente)} é mais novo(a) que ${papel === "pai" ? "o filho" : "o(a) filho(a)"} ${nomeCompleto(p)}`,
            explicacao: `${papel === "pai" ? "O pai" : "A mãe"} nasceu em ${formatarData(parente.data_nasc)} e ${nomeCompleto(p)} em ${formatarData(nasc)}. O vínculo está invertido ou a data errada.`,
            acao: "Inverter o vínculo de filiação ou corrigir a data.",
            pessoaIds: [p.id, parenteId],
            confianca: 1,
          })
        } else if (idadeNoParto < idadeMin) {
          add({
            id: `cron-parente-jovem-${p.id}-${parenteId}`,
            categoria: "conflito",
            severidade: "alto",
            titulo: `${nomeCompleto(parente)} teria ${Math.floor(idadeNoParto)} anos ao nascer ${nomeCompleto(p)}`,
            explicacao: `Idade biologicamente improvável para ${papel} (mínimo considerado: ${idadeMin} anos).`,
            acao: "Provavelmente falta uma geração intermediária — verificar se não é avô/avó.",
            pessoaIds: [p.id, parenteId],
            confianca: 0.9,
          })
        } else if (idadeNoParto > idadeMax) {
          add({
            id: `cron-parente-velho-${p.id}-${parenteId}`,
            categoria: "conflito",
            severidade: papel === "mãe" ? "alto" : "medio",
            titulo: `${nomeCompleto(parente)} teria ${Math.floor(idadeNoParto)} anos ao nascer ${nomeCompleto(p)}`,
            explicacao: `Idade acima do limite considerado para ${papel} (${idadeMax} anos). Costuma indicar geração pulada (é avô/avó, não ${papel}).`,
            acao: "Verificar se existe uma geração intermediária não cadastrada.",
            pessoaIds: [p.id, parenteId],
            confianca: papel === "mãe" ? 0.9 : 0.7,
          })
        }
      }

      // Filho nascido após o óbito do ascendente
      const diasAposObito = diasEntre(parente.data_obito, nasc)
      if (diasAposObito != null && diasAposObito > 0) {
        const limite = papel === "mãe" ? 1 : GESTACAO_MAX_DIAS
        if (diasAposObito > limite) {
          add({
            id: `cron-postumo-${p.id}-${parenteId}`,
            categoria: "conflito",
            severidade: "critico",
            titulo: `${nomeCompleto(p)} nasceu depois do óbito ${papel === "mãe" ? "da mãe" : "do pai"}`,
            explicacao:
              papel === "mãe"
                ? `A mãe faleceu em ${formatarData(parente.data_obito)} e o nascimento consta em ${formatarData(nasc)} — impossível.`
                : `O pai faleceu em ${formatarData(parente.data_obito)} e o nascimento consta ${Math.round(diasAposObito)} dias depois, acima do limite de gestação (${GESTACAO_MAX_DIAS} dias).`,
            acao: "Corrigir a data ou revisar a filiação.",
            pessoaIds: [p.id, parenteId],
            confianca: 0.95,
          })
        }
      }
    }
  }

  // 7. Casamentos
  for (const u of g.unioes) {
    const a = g.pessoa(u.pessoa1Id!)
    const b = g.pessoa(u.pessoa2Id!)
    if (!a || !b) continue

    if (u.data_inicio && u.data_fim) {
      const d = diasEntre(u.data_inicio, u.data_fim)
      if (d != null && d < 0) {
        add({
          id: `cron-uniao-invertida-${u.id}`,
          categoria: "conflito",
          severidade: "alto",
          titulo: `União de ${nomeCompleto(a)} e ${nomeCompleto(b)} termina antes de começar`,
          explicacao: `Início ${formatarData(u.data_inicio)} e fim ${formatarData(u.data_fim)}.`,
          acao: "Corrigir as datas da união.",
          pessoaIds: [a.id, b.id],
          uniaoIds: [u.id],
          confianca: 1,
        })
      }
    }

    if (!u.data_inicio) continue

    for (const pessoa of [a, b]) {
      const idade = anosEntre(pessoa.data_nasc, u.data_inicio)
      if (idade != null && idade < 0) {
        add({
          id: `cron-casou-antes-nascer-${u.id}-${pessoa.id}`,
          categoria: "conflito",
          severidade: "critico",
          titulo: `${nomeCompleto(pessoa)} casou antes de nascer`,
          explicacao: `Casamento em ${formatarData(u.data_inicio)} e nascimento em ${formatarData(pessoa.data_nasc)}.`,
          acao: "Corrigir a data do casamento ou do nascimento.",
          pessoaIds: [pessoa.id],
          uniaoIds: [u.id],
          confianca: 1,
        })
      } else if (idade != null && idade < IDADE_MIN_CASAMENTO) {
        add({
          id: `cron-casou-crianca-${u.id}-${pessoa.id}`,
          categoria: "conflito",
          severidade: "alto",
          titulo: `${nomeCompleto(pessoa)} casou com ${Math.floor(idade)} anos`,
          explicacao: `Idade abaixo do mínimo considerado (${IDADE_MIN_CASAMENTO} anos) na data do casamento.`,
          acao: "Verificar se a data do casamento não é a do registro do filho.",
          pessoaIds: [pessoa.id],
          uniaoIds: [u.id],
          confianca: 0.85,
        })
      }

      const diasPosObito = diasEntre(pessoa.data_obito, u.data_inicio)
      if (diasPosObito != null && diasPosObito > 0) {
        add({
          id: `cron-casou-morto-${u.id}-${pessoa.id}`,
          categoria: "conflito",
          severidade: "critico",
          titulo: `${nomeCompleto(pessoa)} casou depois de falecer`,
          explicacao: `Óbito em ${formatarData(pessoa.data_obito)} e casamento em ${formatarData(u.data_inicio)}.`,
          acao: "Uma das datas está errada — conferir a certidão de casamento.",
          pessoaIds: [pessoa.id],
          uniaoIds: [u.id],
          confianca: 1,
        })
      }
    }

    // Filhos nascidos muito antes do casamento não são erro (comum), mas
    // filho nascido antes de um dos cônjuges nascer já foi coberto acima.
    const casal = g.casal(a.id, b.id)
    if (casal) {
      for (const filhoId of casal.filhos) {
        const filho = g.pessoa(filhoId)
        if (!filho) continue
        const anos = anosEntre(u.data_inicio, filho.data_nasc)
        if (anos != null && anos < -25) {
          add({
            id: `cron-filho-muito-antes-${u.id}-${filhoId}`,
            categoria: "conflito",
            severidade: "medio",
            titulo: `${nomeCompleto(filho)} nasceu ${Math.abs(Math.floor(anos))} anos antes do casamento dos pais`,
            explicacao: "Diferença grande demais entre nascimento do filho e casamento — normalmente é um segundo casamento ou uma data trocada.",
            acao: "Confirmar se este é o casamento correto para esta filiação.",
            pessoaIds: [filhoId, a.id, b.id],
            uniaoIds: [u.id],
            confianca: 0.6,
          })
        }
      }
    }
  }

  // 8. Irmãos com intervalo biologicamente impossível (via mesma mãe)
  const porMae = new Map<number, number[]>()
  for (const p of g.pessoas) {
    if (p.maeId != null && g.existe(p.maeId)) {
      const arr = porMae.get(p.maeId) || []
      arr.push(p.id)
      porMae.set(p.maeId, arr)
    }
  }
  for (const [maeId, filhos] of porMae) {
    const comData = filhos
      .map((id) => ({ id, ts: tsDe(g.pessoa(id)?.data_nasc) }))
      .filter((x) => x.ts != null)
      .sort((x, y) => x.ts! - y.ts!)
    for (let i = 1; i < comData.length; i++) {
      const dias = (comData[i].ts! - comData[i - 1].ts!) / 86400000
      if (dias === 0) continue // gêmeos
      if (dias < INTERVALO_MIN_IRMAOS_DIAS) {
        const f1 = g.pessoa(comData[i - 1].id)!
        const f2 = g.pessoa(comData[i].id)!
        add({
          id: `cron-irmaos-proximos-${f1.id}-${f2.id}`,
          categoria: "conflito",
          severidade: "medio",
          titulo: `${nomeCompleto(f1)} e ${nomeCompleto(f2)} nasceram com ${Math.round(dias)} dias de diferença`,
          explicacao: `Mesma mãe (${nome(maeId)}) com intervalo menor que ${INTERVALO_MIN_IRMAOS_DIAS} dias e datas diferentes — ou uma data está errada, ou é a mesma pessoa cadastrada duas vezes.`,
          acao: "Verificar duplicidade ou corrigir a data de nascimento.",
          pessoaIds: [f1.id, f2.id, maeId],
          confianca: 0.8,
        })
      }
    }
  }

  return out
}

function pesoPadrao(s: Insight["severidade"]): number {
  return { critico: 100, alto: 70, medio: 45, baixo: 25, info: 10 }[s]
}
