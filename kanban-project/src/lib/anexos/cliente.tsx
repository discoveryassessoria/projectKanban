"use client"
// src/lib/anexos/cliente.tsx
// ============================================================================
// ABRIR ANEXO NA TELA. O banco guarda a CHAVE; esta camada a troca por uma URL assinada de 5 minutos, pedida à porta única
// (`POST /api/anexos/abrir`, com o login do usuário). Endereço antigo (público ou de outro serviço) é usado COMO ESTÁ.
//   • `abrirAnexo(valor, nome?)`     — clique "Abrir": abre em nova aba (a aba é aberta ANTES do pedido para o navegador não bloquear).
//   • `useUrlDeAnexo(valor)`         — para `<img src>` / `<iframe src>` / miniatura: devolve a URL (ou `null` enquanto assina) e renova antes de expirar.
//   • `<LinkDeAnexo valor=…>`        — o `<a>` que faz o clique acima (com `href` real para endereço antigo).
// ============================================================================
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react"
import { leituraDoValor } from "./chave"

/** Renova com folga: a URL vale 5 min (300 s); pedimos outra aos 4 min. */
const RENOVAR_APOS_MS = 240_000

function tokenDoUsuario(): string | null {
  try { return typeof window !== "undefined" ? window.localStorage.getItem("authToken") : null } catch { return null }
}

/** Pede à porta a URL assinada da chave. Lança com a mensagem do servidor (401/403/…); nunca devolve endereço fixo. */
export async function pedirUrlAssinada(chave: string, opcoes: { nome?: string; mime?: string; auditar?: boolean; baixar?: boolean } = {}): Promise<string> {
  const token = tokenDoUsuario()
  if (!token) throw new Error("Sua sessão expirou. Faça login novamente.")
  const r = await fetch("/api/anexos/abrir", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ chave, nome: opcoes.nome, mime: opcoes.mime, auditar: opcoes.auditar === true, baixar: opcoes.baixar === true }),
  })
  const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string }
  if (!r.ok || !j.url) throw new Error(j.error || `Não foi possível abrir o anexo (${r.status}).`)
  return j.url
}

/** Clique em "Abrir": nova aba (aberta já, para não ser bloqueada) e, assinada a URL, navega. Erro vira aviso na própria aba/alerta. */
export async function abrirAnexo(valor: string | null | undefined, nome?: string, mime?: string): Promise<void> {
  const l = leituraDoValor(valor)
  if (l.tipo === "vazio") return
  if (l.tipo === "endereco") { window.open(l.url, "_blank", "noopener,noreferrer"); return }
  const aba = window.open("about:blank", "_blank")
  try {
    const url = await pedirUrlAssinada(l.chave, { nome, mime, auditar: true })
    if (aba) aba.location.href = url; else window.location.href = url
  } catch (e) {
    aba?.close()
    window.alert(e instanceof Error ? e.message : "Não foi possível abrir o anexo.")
  }
}

/** Botão "Baixar": como abrir, mas a URL assinada força o download (Content-Disposition: attachment) e a página não muda. */
export async function baixarAnexo(valor: string | null | undefined, nome?: string, mime?: string): Promise<void> {
  const l = leituraDoValor(valor)
  if (l.tipo === "vazio") return
  if (l.tipo === "endereco") { window.open(l.url, "_blank", "noopener,noreferrer"); return }
  try {
    const url = await pedirUrlAssinada(l.chave, { nome, mime, auditar: true, baixar: true })
    window.location.href = url
  } catch (e) {
    window.alert(e instanceof Error ? e.message : "Não foi possível baixar o anexo.")
  }
}

/** URL utilizável do valor guardado: endereço antigo na hora; chave → URL assinada (renovada a cada 4 min). `null` enquanto assina ou se negado. */
export function useUrlDeAnexo(valor: string | null | undefined, opcoes: { nome?: string; mime?: string } = {}): { url: string | null; erro: string | null } {
  const l = leituraDoValor(valor)
  const chave = l.tipo === "chave" ? l.chave : null
  const [assinada, setAssinada] = useState<{ chave: string; url: string } | null>(null)
  const [erro, setErro] = useState<{ chave: string; msg: string } | null>(null)
  const { nome, mime } = opcoes
  useEffect(() => {
    if (!chave) return
    let vivo = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const pedir = () => {
      pedirUrlAssinada(chave, { nome, mime })
        .then((u) => { if (!vivo) return; setAssinada({ chave, url: u }); setErro(null); timer = setTimeout(pedir, RENOVAR_APOS_MS) })
        .catch((e) => { if (vivo) setErro({ chave, msg: e instanceof Error ? e.message : "Não foi possível abrir o anexo." }) })
    }
    pedir()
    return () => { vivo = false; if (timer) clearTimeout(timer) }
  }, [chave, nome, mime])
  if (l.tipo === "endereco") return { url: l.url, erro: null }
  if (!chave) return { url: null, erro: null }
  return { url: assinada?.chave === chave ? assinada.url : null, erro: erro?.chave === chave ? erro.msg : null }
}

type PropsLink = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> & { valor: string | null | undefined; nome?: string; mime?: string; children: ReactNode }

/** O `<a>` de abrir anexo: endereço antigo = link normal; chave = clique pede a URL assinada e abre em nova aba. */
export function LinkDeAnexo({ valor, nome, mime, children, ...resto }: PropsLink) {
  const l = leituraDoValor(valor)
  if (l.tipo === "vazio") return null
  if (l.tipo === "endereco") return <a {...resto} href={l.url} target="_blank" rel="noopener noreferrer">{children}</a>
  const aoClicar = (e: MouseEvent<HTMLAnchorElement>) => { e.preventDefault(); e.stopPropagation(); void abrirAnexo(l.chave, nome, mime) }
  return <a {...resto} href="#abrir-anexo" onClick={aoClicar}>{children}</a>
}
