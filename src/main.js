// Main module — shared utilities across all pages

import { logout } from './auth.js';

// Inactivity timeout (20 min warning, 5 min to respond)
let inactivityTimer;
let warningTimer;
const INACTIVITY_LIMIT = 20 * 60 * 1000; // 20 minutes
const WARNING_LIMIT = 5 * 60 * 1000; // 5 minutes

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  clearTimeout(warningTimer);
  hideTimeoutModal();

  inactivityTimer = setTimeout(() => {
    showTimeoutModal();
    warningTimer = setTimeout(() => {
      logout();
    }, WARNING_LIMIT);
  }, INACTIVITY_LIMIT);
}

function showTimeoutModal() {
  let modal = document.getElementById('timeout-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'timeout-modal';
    modal.innerHTML = `
      <div class="timeout-overlay">
        <div class="timeout-box">
          <h2>Session Timeout</h2>
          <p>You have been inactive. You will be logged out in 5 minutes.</p>
          <button onclick="document.getElementById('timeout-modal').style.display='none'">Stay Logged In</button>
        </div>
      </div>
    `;
    modal.querySelector('button').addEventListener('click', resetInactivityTimer);
    document.body.appendChild(modal);
  }
  modal.style.display = 'block';
}

function hideTimeoutModal() {
  const modal = document.getElementById('timeout-modal');
  if (modal) modal.style.display = 'none';
}

export function initInactivityTimer() {
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(event => {
    document.addEventListener(event, resetInactivityTimer);
  });
  resetInactivityTimer();
}
