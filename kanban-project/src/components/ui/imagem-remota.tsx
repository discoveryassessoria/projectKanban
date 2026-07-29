// src/components/ui/imagem-remota.tsx
// ============================================================================
// Pré-visualização de arquivo de imagem ENVIADO PELO USUÁRIO (anexo, comprovante,
// capa de post) — servido pelo storage remoto (R2) com host/dimensões que a
// aplicação não conhece em tempo de build.
//
// Ponto ÚNICO dessa decisão: o otimizador de imagem do Next não se aplica aqui
// (exigiria allowlist de host e conhecer a geometria do arquivo), então usamos
// `unoptimized`. O dimensionamento continua sendo do CSS de quem chama — por isso
// width/height nominais com `sizes`, o idioma do Next para imagem dimensionada
// por folha de estilo.
// ============================================================================
import Image from 'next/image'

export function ImagemRemota({
  src, alt, className, sizes = '100vw',
}: {
  src: string
  alt: string
  className?: string
  sizes?: string
}) {
  return <Image src={src} alt={alt} width={0} height={0} sizes={sizes} unoptimized className={className} />
}
