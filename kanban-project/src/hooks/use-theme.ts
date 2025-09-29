import { useTheme as useThemeContext } from '@/src/contexts/theme-context'

export const useTheme = () => {
  return useThemeContext()
}