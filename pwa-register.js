// ═══ GéoTer' PWA — Inscription, Installation & Statut Réseau ═══

// ═══ SERVICE WORKER ═══
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(reg => {
        console.log('[GéoTer PWA] Service Worker enregistré:', reg.scope);
        // Détection de mise à jour
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
              showToast('Mise \u00e0 jour disponible \u2014 Rechargez la page', 5000);
            }
          });
        });
      })
      .catch(err => console.warn('[GéoTer PWA] Erreur SW:', err));
  });
}

// ═══ INSTALLATION PWA ═══
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBanner();
});

function showInstallBanner() {
  const $b = document.getElementById('pwa-install-banner');
  if ($b) $b.style.display = 'flex';
}

function dismissInstallBanner() {
  const $b = document.getElementById('pwa-install-banner');
  if ($b) $b.style.display = 'none';
}

function triggerInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(result => {
    if (result.outcome === 'accepted') {
      showToast("G\u00e9oTer' install\u00e9 !");
    }
    deferredInstallPrompt = null;
    dismissInstallBanner();
  });
}

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  dismissInstallBanner();
  showToast("G\u00e9oTer' a \u00e9t\u00e9 install\u00e9 sur cet appareil");
});

// ═══ STATUT RÉSEAU ═══
function updateNetworkStatus() {
  const $bar = document.getElementById('network-status');
  const $dot = document.getElementById('net-dot');
  if (!$bar || !$dot) return;
  if (navigator.onLine) {
    $dot.className = 'online';
    $bar.className = 'back-online';
    $bar.textContent = 'Connexion r\u00e9tablie';
    setTimeout(() => { $bar.className = ''; }, 3000);
  } else {
    $dot.className = 'offline';
    $bar.className = 'offline';
    $bar.textContent = '\u26a0 Hors ligne \u2014 Les fonctions terrain restent disponibles';
  }
}

window.addEventListener('online', () => {
  updateNetworkStatus();
  // Traiter la file d'attente hors-ligne après stabilisation réseau
  setTimeout(() => {
    if (typeof processOfflineQueue === 'function') processOfflineQueue();
  }, 2000);
});
window.addEventListener('offline', updateNetworkStatus);
document.addEventListener('DOMContentLoaded', updateNetworkStatus);

// ═══ TOAST NOTIFICATIONS ═══
function showToast(msg, duration) {
  const $t = document.getElementById('pwa-toast');
  if (!$t) return;
  $t.textContent = msg;
  $t.classList.add('show');
  setTimeout(() => $t.classList.remove('show'), duration || 3000);
}

// ═══ iOS : indication "Ajouter à l'écran d'accueil" ═══
document.addEventListener('DOMContentLoaded', () => {
  if (window.matchMedia('(display-mode: browser)').matches &&
      /iPad|iPhone/.test(navigator.userAgent) && !window.MSStream) {
    const ws = document.getElementById('welcome-screen');
    if (ws) {
      const hint = document.createElement('div');
      hint.style.cssText = 'font-size:11px;color:var(--gray-500);margin-top:10px;text-align:center';
      hint.innerHTML = "Sur Safari : tapez <strong>Partager</strong> puis <strong>Sur l'\u00e9cran d'accueil</strong>";
      ws.appendChild(hint);
    }
  }
});
