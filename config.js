// ===== PR/PO System — app settings =====
window.APP_CONFIG = {
  // Paste your Apps Script Web App URL (ends with /exec). Leave '' to run in DEMO mode.
  API_URL: 'https://script.google.com/macros/s/AKfycbyo-U6dwCnsPTDbHVD5cKRvhJnU2XHJ51CB8JVwp6w1lexrM1KwLedPoKkPme8vLj7-VQ/exec',

  APP_NAME: 'PR / PO',
  REFRESH_SECONDS: 60,

  // Phone push notifications (optional). Fill in after creating a Firebase project — see SETUP.md, Part E.
  // Leave FIREBASE as null to hide push and use Telegram / in-app notifications only.
  FIREBASE: null,
  /* Example:
  FIREBASE: {
    apiKey: 'AIza...',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project',
    messagingSenderId: '1234567890',
    appId: '1:1234567890:web:abc123',
    vapidKey: 'BxxxxxxxxWeb-Push-certificate-key-pair',
  },
  */
};
