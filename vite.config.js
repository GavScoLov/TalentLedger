import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv } from 'vite'

const __dirnameESM = dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirnameESM, '')

  return {
    build: {
      target: 'esnext',
      rollupOptions: {
        input: {
          main: resolve(__dirnameESM, 'index.html'),
          dashboard: resolve(__dirnameESM, 'dashboard.html'),
          commission: resolve(__dirnameESM, 'commission.html'),
          dataVisualization: resolve(__dirnameESM, 'data-visualization.html'),
          hoursBreakdown: resolve(__dirnameESM, 'hours-breakdown.html'),
          profitLoss: resolve(__dirnameESM, 'profit-loss.html'),
          descendingRevenue: resolve(__dirnameESM, 'descending-revenue.html'),
          directHire: resolve(__dirnameESM, 'direct-hire.html'),
          generalStaffing: resolve(__dirnameESM, 'general-staffing.html'),
          psaProfitLoss: resolve(__dirnameESM, 'psa-profit-loss.html'),
          admin: resolve(__dirnameESM, 'admin.html'),
          settings: resolve(__dirnameESM, 'settings.html'),
          stateTax: resolve(__dirnameESM, 'state-tax.html'),
          employerPortal: resolve(__dirnameESM, 'employer-portal.html'),
          rosterTracker: resolve(__dirnameESM, 'roster-tracker.html'),
          tempworks: resolve(__dirnameESM, 'tempworks.html'),
          reports:        resolve(__dirnameESM, 'reports.html'),
          reportEmails:   resolve(__dirnameESM, 'report-emails.html'),
          workerCheckin:       resolve(__dirnameESM, 'worker-checkin.html'),
          workerAssignments:   resolve(__dirnameESM, 'worker-assignments.html'),
          scheduler:           resolve(__dirnameESM, 'scheduler.html'),
          timeTrackerSettings: resolve(__dirnameESM, 'time-tracker-settings.html'),
          timesheetReview:     resolve(__dirnameESM, 'timesheet-review.html'),
          exceptionReports:    resolve(__dirnameESM, 'exception-reports.html'),
        },
      },
    },
    server: {
      proxy: {
        // /api/ts?endpoint=/shifts&... → TimeStation API with Basic Auth injected.
        // In production this is handled by api/ts.js (Vercel serverless function).
        '/api/ts': {
          target: 'https://api.mytimestation.com/v1.2',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              const reqUrl = new URL(req.url, 'http://localhost')
              const endpoint = reqUrl.searchParams.get('endpoint') || ''
              reqUrl.searchParams.delete('endpoint')
              const remaining = reqUrl.searchParams.toString()
              proxyReq.path = endpoint + (remaining ? '?' + remaining : '')

              const apiKey = env.TIMESTATION_API_KEY || ''
              const encoded = Buffer.from(apiKey + ':').toString('base64')
              proxyReq.setHeader('Authorization', `Basic ${encoded}`)
              proxyReq.setHeader('Accept', 'application/json')
            })
          },
        },
        '/api/psa': {
          target: 'https://api.psastaffing.com',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              // Extract endpoint from query string and rewrite the path
              const reqUrl = new URL(req.url, 'http://localhost')
              const endpoint = reqUrl.searchParams.get('endpoint') || ''
              reqUrl.searchParams.delete('endpoint')
              const remaining = reqUrl.searchParams.toString()
              const newPath = endpoint + (remaining ? '?' + remaining : '')
              proxyReq.path = newPath

              const token = env.PSA_API_TOKEN || ''
              if (token) {
                proxyReq.setHeader('Authorization', `Bearer ${token}`)
              }
              proxyReq.setHeader('Accept', 'application/json')
            })
          },
        },
      },
    },
  }
})
