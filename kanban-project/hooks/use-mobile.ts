import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    mql.addEventListener("change", onChange)
    // Primeira leitura no próximo quadro: o valor inicial já é o do servidor.
    const id = requestAnimationFrame(onChange)
    return () => { cancelAnimationFrame(id); mql.removeEventListener("change", onChange) }
  }, [])

  return !!isMobile
}
