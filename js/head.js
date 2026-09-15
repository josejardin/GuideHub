import { requireRole, initNavbar } from './auth.js';
import { getAnalyticsDataset } from './db.js';

document.addEventListener('DOMContentLoaded', () => {
  const currentUser = requireRole(['head', 'admin']);
  if (!currentUser) return;

  initNavbar('navbar-container', 'head');

  const welcomeText = document.getElementById('head-welcome-text');
  if (welcomeText) {
    welcomeText.textContent = `${currentUser.fullName} • NU Fairview Guidance Analytics & Executive Summary`;
  }

  document.getElementById('btn-export-report')?.addEventListener('click', () => {
    window.print();
  });

  let cycleChartInstance = null;
  let concernChartInstance = null;
  let channelChartInstance = null;

  function loadAndRenderAnalytics() {
    const data = getAnalyticsDataset();

    const kpiCompleted = document.getElementById('kpi-completed-sessions');
    const kpiReferrals = document.getElementById('kpi-total-referrals');
    const kpiHighRisk = document.getElementById('kpi-high-risk');
    const kpiNoShow = document.getElementById('kpi-noshow-rate');

    if (kpiCompleted) kpiCompleted.textContent = data.completedSessions;
    if (kpiReferrals) kpiReferrals.textContent = data.totalReferrals;
    if (kpiHighRisk) kpiHighRisk.textContent = data.highRiskCases;
    if (kpiNoShow) kpiNoShow.textContent = data.noShowRate;

    const cycleCanvas = document.getElementById('cycleChart');
    if (cycleCanvas) {
      if (cycleChartInstance) cycleChartInstance.destroy();

      const cycleLabels = Object.keys(data.cycleTrends);
      const cycleValues = Object.values(data.cycleTrends);

      cycleChartInstance = new Chart(cycleCanvas, {
        type: 'bar',
        data: {
          labels: cycleLabels,
          datasets: [
            {
              data: cycleValues,
              backgroundColor: ['#00205B', '#F5B800', '#0A192F', '#10B981'],
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { size: 10, family: 'Inter' }, color: '#64748b' }
            },
            y: {
              beginAtZero: true,
              grid: { color: '#f1f5f9' },
              ticks: { stepSize: 1, precision: 0, font: { size: 10, family: 'Inter' }, color: '#64748b' }
            }
          }
        }
      });
    }

    const concernCanvas = document.getElementById('concernChart');
    if (concernCanvas) {
      if (concernChartInstance) concernChartInstance.destroy();

      const concernLabels = Object.keys(data.concernBreakdown);
      const concernValues = Object.values(data.concernBreakdown);

      concernChartInstance = new Chart(concernCanvas, {
        type: 'doughnut',
        data: {
          labels: concernLabels,
          datasets: [
            {
              data: concernValues,
              backgroundColor: ['#00205B', '#F5B800', '#0A192F', '#64748B', '#D97706'],
              borderWidth: 2,
              borderColor: '#ffffff'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                boxWidth: 8,
                padding: 12,
                font: { size: 10, family: 'Inter' },
                color: '#334155'
              }
            }
          },
          cutout: '68%'
        }
      });
    }

    const channelCanvas = document.getElementById('channelChart');
    if (channelCanvas) {
      if (channelChartInstance) channelChartInstance.destroy();

      channelChartInstance = new Chart(channelCanvas, {
        type: 'pie',
        data: {
          labels: ['Walk-Ins', 'Scheduled'],
          datasets: [
            {
              data: [data.walkInRatio.walkIn, data.walkInRatio.scheduled],
              backgroundColor: ['#F5B800', '#00205B'],
              borderWidth: 2,
              borderColor: '#ffffff'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                boxWidth: 8,
                padding: 12,
                font: { size: 10, family: 'Inter' },
                color: '#334155'
              }
            }
          }
        }
      });
    }
  }

  loadAndRenderAnalytics();
  window.addEventListener('guidehub_data_changed', loadAndRenderAnalytics);
});
