// scripts/requerimento-doc21-opcional.test.ts
// GUARDA (06/10/2026): o REQUERIMENTO INTEIRO TEOR é OPCIONAL por enquanto em «Solicitar certidão» — os processos estão entrando no ar e os requerimentos já
// foram enviados. Uma chave só (`requerimento-opcional.ts`) liga/desliga; servidor e tela leem a mesma. Nada foi gravado no cadastro (canais, exigências).
import { readFileSync } from "node:fs"
import { REQUERIMENTO_ENVIADO_OBRIGATORIO } from "../src/lib/process-stage/requerimento-opcional"
import { faltamCamposDoCanal } from "../src/lib/process-stage/canais-solicitacao"
import { exigenciasNaoAtendidas, type ExigenciaEvidenciaDTO } from "../src/services/exigencia-evidencia"

let passou = 0, falhou = 0
const falhas: string[] = []
const ok = (n: string, c: boolean, extra = "") => { if (c) { passou++; console.log(`  ✅ ${n}`) } else { falhou++; falhas.push(n); console.log(`  ❌ ${n}${extra ? ` — ${extra}` : ""}`) } }
const ler = (p: string) => readFileSync(p, "utf8")

ok("a chave está em «opcional» (false)", REQUERIMENTO_ENVIADO_OBRIGATORIO === false)
for (const canal of ["EMAIL", "WHATSAPP", "BALCAO", "CORREIOS", "CRC_NACIONAL", "E_CARTORIO", "COMUNE_ITALIANA", "CONSULADO"]) {
  const f = faltamCamposDoCanal({ canal, anexoUrl: null, numeroProtocolo: null, codigoRastreio: "RA123", observacao: "obs", destinatarioNome: "Cartório" } as never)
  ok(`canal ${canal}: sem o anexo do requerimento NÃO falta «REQUERIMENTO»`, !f.includes("REQUERIMENTO"), f.join())
}
const exig = (finalidade: string, obrigatoria = true): ExigenciaEvidenciaDTO => ({ id: 1, stepKey: "solicitar_certidao", canal: null, documentoTipoId: 2, finalidade, obrigatoria, cardinalidadeMax: 1, documentoMestre: { id: 21, code: "DOC21", publicCode: "DOC21", name: "Requerimento inteiro teor" } } as never)
ok("exigência de evidência do requerimento (REQUERIMENTO_ENVIADO) não conta como não atendida", exigenciasNaoAtendidas([exig("REQUERIMENTO_ENVIADO")], []).length === 0)
ok("outra evidência obrigatória continua valendo (a regra geral não afrouxou)", exigenciasNaoAtendidas([exig("COMPROVANTE_PROTOCOLO")], []).length === 1)
ok("o requisito da etapa (ExigenciaEvidenciaEtapa) deixa o requerimento de fora da lista de pendentes", /\.\.\.\(REQUERIMENTO_ENVIADO_OBRIGATORIO \? \{\} : \{ finalidade: \{ not: "REQUERIMENTO_ENVIADO"/.test(ler("src/services/requisitos-da-etapa.ts")))
const tela = ler("src/components/kanban/workflow/StepEditors.tsx")
ok("a tela não bloqueia nem marca «obrigatório» (campo opcional, anexo continua disponível)", /REQUERIMENTO_ENVIADO_OBRIGATORIO && canalConfig\.requires\.attachment && !anexoDisponivel/.test(tela) && /required=\{REQUERIMENTO_ENVIADO_OBRIGATORIO\}/.test(tela))
ok("o servidor de «Solicitar certidão» valida o canal pelo cadastro com a mesma chave", /REQUERIMENTO_ENVIADO_OBRIGATORIO && cfg\.anexoObrigatorioLabel/.test(ler("src/lib/process-stage/canais-fonte.ts")))
console.log(`\n${passou} ok, ${falhou} falha(s)`)
if (falhou) { console.log(falhas.join("\n")); process.exit(1) }
