// scripts/previa-publicacao.ts
//
// O QUE MUDA SE EU PUBLICAR — passo a passo, atributo por atributo.
//
// `preverPublicacao` já devolve a lista de alterações, e ela responde "o que mudou".
// Não responde "como o passo vai ficar", que é a pergunta de quem está decidindo se
// publica. Um total de 42 alterações não diz se o campo de órgão aponta para o
// cadastro certo, nem se algum passo ficou sem prazo por engano.
//
//   npx tsx scripts/previa-publicacao.ts <phaseKey>

import { PrismaClient } from "@prisma/client"
import { preverPublicacao } from "../src/services/publicacao-de-workflow"
import { fonteDoCampo, alvoDeReferencia } from "../src/lib/motor/fontes-de-campo"
import { temPrazoProprio } from "../lib/operacional/tempo-operacional"
import { efeito } from "../src/lib/motor/catalogo-de-efeitos"

const prisma = new PrismaClient()
const FASE = process.argv[2] ?? "retificacao_registros"

function fonteLegivel(tipo: string, opcoes: unknown, opcoesCadastradas: { key: string; ativo: boolean }[]) {
  const f = fonteDoCampo(opcoes)
  if (f?.especie === "REFERENCIA") {
    const a = alvoDeReferencia(f.alvo)
    return `→ referência a ${a?.label ?? f.alvo} (${a?.entidade ?? "?"}, grava o ID)`
  }
  if (f?.especie === "DATASOURCE") return `→ catálogo "${f.fonte}" (grava a chave)`
  const ativas = opcoesCadastradas.filter((o) => o.ativo !== false)
  if (ativas.length) return `→ ${ativas.length} opção(ões): ${ativas.map((o) => o.key).join(", ")}`
  return tipo === "select" || tipo === "radio" || tipo === "multiselect" ? "→ SEM OPÇÃO" : ""
}

async function main() {
  const wf = await prisma.phaseInternalWorkflow.findFirst({
    where: { phaseKey: FASE, arquivado: false },
    select: {
      id: true, name: true, versao: true, execucao: true, rascunhoAlteradoEm: true,
      passos: {
        orderBy: { ordem: "asc" },
        select: {
          key: true, label: true, ordem: true, executorKey: true, cardinalidade: true,
          slaDays: true, owner: true, required: true, regraDeConclusao: true, dependeDe: true,
          campos: { where: { ativo: true }, orderBy: { ordem: "asc" },
            select: { key: true, label: true, tipo: true, obrigatorio: true, opcoes: true,
              opcoesCadastradas: { select: { key: true, ativo: true } } } },
          acoes: { where: { ativo: true }, orderBy: { ordem: "asc" },
            select: { key: true, label: true, effectKey: true, requerCampos: true } },
          checkItens: { where: { ativo: true }, orderBy: { ordem: "asc" }, select: { key: true, obrigatorio: true } },
          requisitos: { where: { ativo: true }, orderBy: { ordem: "asc" },
            select: { key: true, tipo: true, alvoKey: true, acaoKey: true } },
          subtarefas: { where: { ativo: true }, select: { key: true } },
        },
      },
    },
  })
  if (!wf) { console.log(`nenhum workflow para a fase ${FASE}`); return }

  const fase = await prisma.catalogoFase.findFirst({
    where: { phaseKey: FASE }, select: { escopo: true, slaDiasPadrao: true, efeitosPermitidos: true },
  })
  const p = await preverPublicacao(wf.id)
  // `preverPublicacao` devolve `null` quando o workflow sumiu entre uma leitura e
  // outra. Aqui é leitura pura: dizer isso e sair vale mais que quebrar no console.
  if (!p) { console.log("não foi possível montar a prévia — o workflow não respondeu."); return }

  console.log(`\n${"═".repeat(78)}`)
  console.log(`PRÉVIA — ${wf.name}`)
  console.log(`fase ${FASE} · escopo ${fase?.escopo ?? "?"} · prazo da fase ${fase?.slaDiasPadrao ?? "?"} dia(s)`)
  console.log(`v${wf.versao} → v${wf.versao + 1} · execução ${wf.execucao} · rascunho pendente: ${!!wf.rascunhoAlteradoEm}`)
  console.log(`podePublicar=${p.podePublicar} · problemas=${p.problemas.length} · alterações=${p.mudancas.length}`)
  for (const pr of p.problemas) console.log(`  ✗ [${pr.codigo}] ${pr.stepKey ?? "-"}: ${pr.mensagem}`)
  console.log("═".repeat(78))

  const porPasso = new Map<string, string[]>()
  for (const m of p.mudancas) porPasso.set(m.passo || "—", [...(porPasso.get(m.passo || "—") ?? []), `${m.escopo} ${m.tipo}: ${m.alvo}${m.detalhe ? ` — ${m.detalhe}` : ""}`])

  for (const s of wf.passos) {
    const card = s.cardinalidade ?? `herda da fase (${fase?.escopo ?? "?"})`
    const prazo = temPrazoProprio(s.slaDays) ? `${s.slaDays} dia(s) — PRÓPRIO` : `padrão da fase — HERDADO`
    console.log(`\n${s.ordem}. ${s.label}   [${s.key}]`)
    console.log(`   executor        ${s.executorKey ?? "(resolvido pela chave)"}`)
    console.log(`   cardinalidade   ${card}`)
    console.log(`   prazo           ${prazo}`)
    console.log(`   obrigatório     ${s.required}   · responsável padrão: ${s.owner ?? "nenhum (herda a distribuição)"}`)
    console.log(`   conclusão       ${s.regraDeConclusao ?? "ACAO_DO_PASSO"}`)
    console.log(`   depende de      ${(s.dependeDe as string[])?.length ? (s.dependeDe as string[]).join(", ") : "— (primeiro da cadeia)"}`)

    if (s.campos.length) {
      console.log(`   campos (${s.campos.length})`)
      for (const c of s.campos) {
        const fonte = fonteLegivel(c.tipo, c.opcoes, c.opcoesCadastradas)
        console.log(`     · ${c.key.padEnd(22)} ${c.tipo.padEnd(11)}${c.obrigatorio ? "obrigatório " : "            "}${fonte}`)
      }
    }
    if (s.acoes.length) {
      console.log(`   ações (${s.acoes.length})`)
      for (const a of s.acoes) {
        const d = efeito(a.effectKey)
        const req = Array.isArray(a.requerCampos) && a.requerCampos.length ? ` · exige ${(a.requerCampos as string[]).join(", ")}` : ""
        console.log(`     · ${a.key.padEnd(22)} ${a.effectKey.padEnd(26)}${d?.concluiPasso ? "conclui" : "não conclui"}${req}`)
        if (d?.exigeAutorizacaoExplicita) console.log(`       ↳ efeito de autorização explícita: só roda em fase que o declara nominalmente`)
        if (d?.camposConsumidos?.length) console.log(`       ↳ consome (o valor sai da execução e vai para o dono): ${d.camposConsumidos.join(", ")}`)
      }
    }
    if (s.requisitos.length) {
      console.log(`   requisitos (${s.requisitos.length})`)
      for (const r of s.requisitos) console.log(`     · ${r.key.padEnd(22)} ${r.tipo}${r.alvoKey ? ` → ${r.alvoKey}` : ""}${r.acaoKey ? ` (na ação ${r.acaoKey})` : ""}`)
    }
    if (s.checkItens.length) {
      console.log(`   conferência (${s.checkItens.length})`)
      for (const c of s.checkItens) console.log(`     · ${c.key}${c.obrigatorio ? " (obrigatório)" : ""}`)
    }
    if (s.subtarefas.length) console.log(`   subtarefas      ${s.subtarefas.map((x) => x.key).join(", ")}`)

    const mud = porPasso.get(s.label) ?? []
    if (mud.length) { console.log(`   MUDA (${mud.length})`); mud.forEach((m) => console.log(`     ${m}`)) }
  }

  const globais = porPasso.get("—") ?? []
  if (globais.length) {
    console.log(`\nMUDANÇAS DE ATRIBUTO DO PASSO (${globais.length})`)
    globais.forEach((m) => console.log(`  ${m}`))
  }
  console.log(`\n${"═".repeat(78)}\nNADA FOI PUBLICADO. Isto é leitura.\n`)
}
void main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
