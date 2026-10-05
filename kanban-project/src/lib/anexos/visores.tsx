"use client"
// src/lib/anexos/visores.tsx — `<img>`, `<iframe>` e miniatura de PDF para anexo guardado por CHAVE: pedem a URL assinada (5 min, renovada)
// e só então desenham. Endereço antigo (público ou externo) aparece na hora, como sempre. Sem permissão: mostra o aviso no lugar do arquivo.
import type { ImgHTMLAttributes, IframeHTMLAttributes } from "react"
import { useUrlDeAnexo } from "./cliente"
import { PDFThumbnail } from "@/src/components/pdf-thumbnail"

const Espera = ({ className, erro }: { className?: string; erro: string | null }) => (
  <div className={className} role={erro ? "alert" : "status"} style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 48, fontSize: 12, opacity: 0.7, textAlign: "center", padding: 6 }}>
    {erro ?? "Carregando…"}
  </div>
)

type PropsImg = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { valor: string | null | undefined }
export function ImagemDeAnexo({ valor, alt, ...resto }: PropsImg) {
  const { url, erro } = useUrlDeAnexo(valor)
  if (!url) return <Espera className={resto.className} erro={erro} />
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...resto} src={url} alt={alt ?? ""} />
}

type PropsIframe = Omit<IframeHTMLAttributes<HTMLIFrameElement>, "src"> & { valor: string | null | undefined }
export function IframeDeAnexo({ valor, title, ...resto }: PropsIframe) {
  const { url, erro } = useUrlDeAnexo(valor)
  if (!url) return <Espera className={resto.className} erro={erro} />
  return <iframe {...resto} src={url} title={title} />
}

export function MiniaturaPdfDeAnexo({ valor, className }: { valor: string | null | undefined; className?: string }) {
  const { url, erro } = useUrlDeAnexo(valor)
  if (!url) return <Espera className={className} erro={erro} />
  return <PDFThumbnail url={url} className={className} />
}
