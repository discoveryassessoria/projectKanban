"use client"

import React, { createContext, useContext } from 'react'

// Sistema é fixo em tema claro. Não detecta preferência do SO,
// não usa localStorage. O provider continua existindo apenas para
// não quebrar componentes que ainda chamam useTheme() — todos agora
// recebem 'light'.

type Theme = 'light'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

const FIXED: ThemeContextType = {
  theme: 'light',
  toggleTheme: () => {},
  setTheme: () => {},
}

const ThemeContext = createContext<ThemeContextType>(FIXED)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeContext.Provider value={FIXED}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)