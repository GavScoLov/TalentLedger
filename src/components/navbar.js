import { logout, getProfile } from '../auth.js';
import { toggleSidebar } from './sidebar.js';

export function renderNavbar() {
  const nav = document.createElement('div');
  nav.innerHTML = `
    <header class="topbar">
      <div class="topbar-left">
        <button class="topbar-hamburger" id="topbar-hamburger" aria-label="Toggle menu">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
        </button>
        <span class="topbar-title">TalentLedger</span>
      </div>
      <div class="topbar-spacer"></div>
      <div class="topbar-right">
        <div class="topbar-divider"></div>
        <button class="topbar-user" id="topbar-user-btn">
          <div class="topbar-avatar" id="topbar-avatar">U</div>
          <span id="topbar-username">Account</span>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:14px;height:14px"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
        </button>
        <div class="topbar-dropdown" id="topbar-dropdown">
          <a href="#" id="topbar-logout">Logout</a>
        </div>
      </div>
    </header>
  `;

  document.body.prepend(nav);

  // Hamburger toggle
  document.getElementById('topbar-hamburger').addEventListener('click', toggleSidebar);

  // User dropdown toggle
  const userBtn = document.getElementById('topbar-user-btn');
  const dropdown = document.getElementById('topbar-dropdown');

  userBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    dropdown.classList.remove('open');
  });

  // Logout
  document.getElementById('topbar-logout').addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });

  // Load user profile
  getProfile().then(profile => {
    if (profile) {
      const name = profile.username || profile.email || 'User';
      document.getElementById('topbar-username').textContent = name;
      document.getElementById('topbar-avatar').textContent = name.charAt(0).toUpperCase();
    }
  }).catch(() => {});
}
