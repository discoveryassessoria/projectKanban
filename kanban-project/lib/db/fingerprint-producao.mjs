// lib/db/fingerprint-producao.mjs
//
// IDENTIDADE ESPERADA DO BANCO DE PRODUÇÃO — sem guardar segredo nenhum.
//
// O QUE ISTO RESOLVE
// ------------------
// Em 04/08/2026 as variáveis `PRISMA_DATABASE_URL` e `DIRECT_DATABASE_URL`
// perderam o target `production` no projeto Vercel. O build passou (nada no build
// precisa do banco), o deployment subiu, o alias virou — e só então o app caiu
// inteiro com `PrismaClientInitializationError: Environment variable not found`.
// Login, crons e toda rota que toca banco devolveram 500.
//
// Duas lições viraram código:
//   1. build que sobe para produção sem a variável do banco é build QUEBRADO —
//      tem de falhar antes, não depois do alias virar;
//   2. ter a variável não basta: ela precisa apontar para o banco CERTO. A
//      entrada de Preview aponta para a homologação; promovê-la por engano
//      colocaria produção em cima do banco de homologação sem nenhum aviso.
//
// COMO A IDENTIDADE É GUARDADA
// ----------------------------
// Não guardamos a URL. Guardamos o sha256 de `identificador(url)` — que já é só
// host + database + os 8 primeiros caracteres do usuário, sem senha e sem token.
// O hash não permite reconstruir nada; serve apenas para responder "é o mesmo
// banco de sempre?". Trocar de banco de propósito exige atualizar esta constante
// no mesmo commit — que é exatamente a revisão que se quer.

import { createHash } from 'node:crypto'
import { identificador } from './identidade-banco.mjs'

/** Variáveis sem as quais produção não funciona. Ausência = build reprovado. */
export const VARIAVEIS_DE_BANCO = ['PRISMA_DATABASE_URL', 'DIRECT_DATABASE_URL']

/**
 * Fingerprint do banco de PRODUÇÃO, por variável.
 * Registrado em 04/08/2026, conferido contra o banco com os dados reais
 * (764 requerentes, processo 505, 7 migrations aplicadas).
 */
export const FINGERPRINT_PRODUCAO = {
  PRISMA_DATABASE_URL: '7c979f1c694eeea2eed619b6f00987034c7aeb829dc07366fcd3e57a0d5c83e1',
  DIRECT_DATABASE_URL: '5dedaff15783bf620f77cde635ff5568a82e1168e3846ff958011380a766ed84',
}

/** Hosts que NUNCA podem servir produção — são homologação/preview. */
export const HOSTS_DE_HOMOLOGACAO = [/neon\.tech$/i, /neon\.build$/i]

export function fingerprintDe(url) {
  return createHash('sha256').update(identificador(url)).digest('hex')
}

/** Host mascarado — o suficiente para diagnosticar, insuficiente para vazar. */
export function hostMascarado(url) {
  try {
    const h = new URL(url).host
    return h.length > 10 ? `${h.slice(0, 2)}${'*'.repeat(h.length - 8)}${h.slice(-6)}` : '***'
  } catch {
    return '(url ilegível)'
  }
}

export const MOTIVO = {
  AUSENTE: 'VARIAVEL_AUSENTE',
  ILEGIVEL: 'URL_ILEGIVEL',
  HOMOLOGACAO: 'APONTA_PARA_HOMOLOGACAO',
  OUTRO_BANCO: 'BANCO_DIFERENTE_DO_ESPERADO',
  OK: 'OK',
}

/**
 * Confere UMA variável. PURO: só olha a string, não abre conexão — por isso serve
 * dentro do build, onde conectar não é garantido nem desejável.
 *
 * Devolve sempre o mesmo formato, com motivo NOMEADO: quem lê precisa distinguir
 * "não configurada" de "configurada para o banco errado". As duas quebram
 * produção, mas o conserto de cada uma é outro.
 */
export function conferirVariavel(nome, valor) {
  if (!valor || !valor.trim()) {
    return { nome, ok: false, motivo: MOTIVO.AUSENTE, host: null, fingerprint: null }
  }
  let hostname
  try {
    // `hostname`, NÃO `host`: este último traz a porta junto ("…neon.tech:5432"),
    // e aí um padrão ancorado no fim do domínio nunca casaria. O caso continuaria
    // sendo reprovado — porém pelo motivo errado ("banco diferente"), escondendo
    // que o alvo era a HOMOLOGAÇÃO, que é o diagnóstico que muda o conserto.
    hostname = new URL(valor).hostname
  } catch {
    return { nome, ok: false, motivo: MOTIVO.ILEGIVEL, host: null, fingerprint: null }
  }
  const base = { nome, host: hostMascarado(valor), fingerprint: fingerprintDe(valor).slice(0, 12) }
  if (HOSTS_DE_HOMOLOGACAO.some((re) => re.test(hostname))) {
    return { ...base, ok: false, motivo: MOTIVO.HOMOLOGACAO }
  }
  const esperado = FINGERPRINT_PRODUCAO[nome]
  if (esperado && fingerprintDe(valor) !== esperado) {
    return { ...base, ok: false, motivo: MOTIVO.OUTRO_BANCO }
  }
  return { ...base, ok: true, motivo: MOTIVO.OK }
}

/** Confere as duas variáveis de uma vez. */
export function conferirAmbiente(env = process.env) {
  return VARIAVEIS_DE_BANCO.map((n) => conferirVariavel(n, env[n]))
}

/** Frase operacional do motivo — nunca devolve valor, host cru nem segredo. */
export const EXPLICACAO = {
  [MOTIVO.AUSENTE]:
    'a variável não existe no ambiente. Em produção isso derruba TODA rota que toca banco (login inclusive). Confira o target Production no projeto Vercel.',
  [MOTIVO.ILEGIVEL]: 'a variável existe mas não é uma URL de conexão válida.',
  [MOTIVO.HOMOLOGACAO]:
    'a variável aponta para um host de HOMOLOGAÇÃO. Produção jamais pode rodar sobre o banco de homologação — provavelmente a entrada de Preview foi promovida por engano.',
  [MOTIVO.OUTRO_BANCO]:
    'a variável aponta para um banco DIFERENTE do registrado como produção. Se a troca é intencional, atualize FINGERPRINT_PRODUCAO no mesmo commit.',
  [MOTIVO.OK]: 'confere com o banco de produção registrado.',
}
