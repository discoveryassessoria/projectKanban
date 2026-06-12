// src/lib/confetti.ts
// Dispara confete (só no cliente). Use em handlers de sucesso.

export async function celebrar() {
  if (typeof window === "undefined") return
  const confetti = (await import("canvas-confetti")).default

  // duas rajadas das laterais, pra encher a tela
  const fire = (x: number, angle: number) =>
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { x, y: 0.7 },
      angle,
      startVelocity: 45,
      zIndex: 99999,
    })

  fire(0.15, 60)
  fire(0.85, 120)
}