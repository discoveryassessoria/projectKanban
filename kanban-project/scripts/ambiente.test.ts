// scripts/ambiente.test.ts
// Testes do motor de ambiente por país (parte pura, sem DOM). Rodar:
//   tsx scripts/ambiente.test.ts
// Os casos que dependem de navegador (crossfade real, preload por onload, limpeza
// de timers na desmontagem, pausa por visibilidade em runtime) são validados
// visualmente em produção — aqui garantimos a LÓGICA que os governa.

import { AMBIENTE_PAISES, AMBIENTE_NEUTRO, normalizarPais, paletaCss } from "@/src/lib/ambiente/paises"
import { imagensDoPais, resolverImagem, enquadramentoDaFase } from "@/src/lib/ambiente/imagens"
import { rotaEhNeutra } from "@/src/lib/ambiente/rotas"
import { proximoIndice, deveRotacionar, duracaoFade, indiceInicialValido } from "@/src/lib/ambiente/transicao"
import { _ambienteInternals } from "@/src/contexts/ambiente-context"

const { montar } = _ambienteInternals
let passed = 0, failed = 0
function ok(cond: boolean, nome: string, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✅ ${nome}`) }
  else { failed++; console.log(`  ❌ ${nome}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`) }
}

console.log("\nMotor de ambiente — testes\n")

// 1) As sete paletas continuam registradas
console.log("1) Paletas")
const KEYS = ["italia", "espanha", "portugal", "franca", "alemanha", "polonia", "austria"]
ok(Object.keys(AMBIENTE_PAISES).length === 7, "exatamente 7 países", Object.keys(AMBIENTE_PAISES))
ok(KEYS.every((k) => (AMBIENTE_PAISES as Record<string, unknown>)[k]), "todas as 7 chaves presentes")
ok(!!AMBIENTE_NEUTRO && !!AMBIENTE_NEUTRO.tokens, "neutro registrado")

// 2) --amb-* SÓ controla propriedades visuais (nada estrutural)
console.log("\n2) Variáveis restritas a visual")
const vars = Object.keys(paletaCss(AMBIENTE_PAISES.italia.tokens))
ok(vars.every((v) => v.startsWith("--amb-")), "todas começam com --amb-", vars)
const estruturais = ["--amb-vidro", "--amb-borda", "--amb-hover", "--amb-skeleton"]
ok(estruturais.every((v) => !vars.includes(v)), "sem tokens que tingem superfícies (vidro/borda/hover/skeleton)")
ok(vars.includes("--amb-scrim") && vars.includes("--amb-ceu-1"), "expõe véu + céu procedural")

// 3) País ativo correto / aliases
console.log("\n3) Normalização de país")
ok(normalizarPais("ITALIA") === "italia" && normalizarPais("itália") === "italia" && normalizarPais("IT") === "italia" && normalizarPais("italy") === "italia", "aliases da Itália caem em 'italia'")
ok(normalizarPais("alemão") === "alemanha" && normalizarPais("DE") === "alemanha", "aliases da Alemanha")
ok(normalizarPais("xyz") === null && normalizarPais(null) === null, "desconhecido/nulo → null")

// 4) Modo neutro vs contextual
console.log("\n4) Modo")
ok(montar(null, null, null, null, null).modo === "neutro", "sem país → neutro")
ok(montar("italia", 1, "IT-1", null, "genealogia").modo === "contextual", "com país → contextual")
ok(montar(null, null, null, null, null).pais === null, "neutro tem pais null")

// 5) País PERSISTE durante navegação interna (a chave não depende de módulo/aba)
console.log("\n5) Persistência do país na navegação interna")
const cenaA = montar("italia", 154, "IT-154", "Rossi", "emissao_documental")
const cenaB = montar("italia", 154, "IT-154", "Rossi", "emissao_documental")
ok(cenaA.chave === cenaB.chave, "mesma cena (mesmo processo/país/fase) → mesma chave")
ok(cenaA.pais === "italia", "país preservado")
// Trocar de PAÍS muda a chave (dispara crossfade / cancela timer anterior)
ok(montar("espanha", 154, "ES-1", null, "emissao_documental").chave !== cenaA.chave, "trocar de país muda a chave")

// 6) Financeiro Geral neutro; Kanban/processo dirigidos pela tela
console.log("\n6) Rotas neutras")
ok(rotaEhNeutra("/financas") && rotaEhNeutra("/financeiro"), "Financeiro Geral é neutro")
ok(rotaEhNeutra("/administrator") && rotaEhNeutra("/dashboard"), "Gerenciamento/Dashboard neutros")
ok(!rotaEhNeutra("/kanban"), "Kanban NÃO é forçado a neutro")
ok(!rotaEhNeutra("/genealogy"), "Árvore (dentro do processo) NÃO é forçada a neutro")

// 7) Manifesto vazio → fallback procedural
console.log("\n7) Fallback sem imagens")
ok(imagensDoPais("italia", "cidade").length === 0, "país sem imagens → lista vazia")
ok(resolverImagem("italia", "cidade", "x") === null, "resolverImagem → null (usa céu procedural)")
ok(montar("italia", 1, null, null, null).imagens.length === 0, "cena sem imagens → imagens vazias")

// 8) Enquadramento por fase
console.log("\n8) Enquadramento")
ok(enquadramentoDaFase("genealogia") === "aerea", "genealogia → aérea")
ok(enquadramentoDaFase("aguardando_protocolo") === "consulado", "protocolo → consulado")
ok(enquadramentoDaFase("finalizado") === "paisagem", "finalizado → paisagem")
ok(enquadramentoDaFase("emissao_documental") === "cidade" && enquadramentoDaFase(null) === "cidade", "default → cidade")

// 9) Decisões de transição/rotação (governam timers, concorrência, reduced-motion)
console.log("\n9) Transição/rotação")
ok(proximoIndice(3, 2) === 0 && proximoIndice(3, 0) === 1, "próximo índice cíclico")
ok(proximoIndice(0, 5) === 0, "sem imagens → índice 0")
ok(indiceInicialValido(3, 7) === 1 && indiceInicialValido(0, 5) === 0, "índice inicial válido")
ok(deveRotacionar(1, true, false) === false, "1 imagem não rotaciona")
ok(deveRotacionar(3, true, false) === true, "≥2 imagens, aba visível, sem transição → rotaciona")
ok(deveRotacionar(3, false, false) === false, "aba invisível → NÃO rotaciona")
ok(deveRotacionar(3, true, true) === false, "transição em andamento → NÃO rotaciona (sem concorrência)")
ok(duracaoFade(true, "pais", 1000, 1400) === 0, "prefers-reduced-motion → duração 0 (estável, sem flash)")
ok(duracaoFade(false, "pais", 1000, 1400) === 1000 && duracaoFade(false, "rotacao", 1000, 1400) === 1400, "durações normais por tipo")

console.log(`\n${passed} passaram, ${failed} falharam\n`)
process.exit(failed > 0 ? 1 : 0)
