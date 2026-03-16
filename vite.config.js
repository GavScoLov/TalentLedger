import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        commission: resolve(__dirname, 'commission.html'),
        dataVisualization: resolve(__dirname, 'data-visualization.html'),
        profitLoss: resolve(__dirname, 'profit-loss.html'),
        descendingRevenue: resolve(__dirname, 'descending-revenue.html'),
        directHire: resolve(__dirname, 'direct-hire.html'),
        generalStaffing: resolve(__dirname, 'general-staffing.html'),
        psaProfitLoss: resolve(__dirname, 'psa-profit-loss.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
})
