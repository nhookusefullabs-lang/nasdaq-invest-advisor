import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 배포 시 base를 repo명으로 설정 (PRD §6)
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/nasdaq-invest-advisor/',
})
