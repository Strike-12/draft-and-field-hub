import { Clerk } from '@clerk/clerk-js';
import { ui } from '@clerk/ui';

const appearance = {
  variables: {
    colorPrimary: '#06D6A0',
    colorForeground: '#FFFFFF',
    colorMutedForeground: '#AAB6CA',
    colorDanger: '#F87171',
    colorBackground: '#1C2540',
    colorInput: '#0B132B',
    colorInputForeground: '#FFFFFF',
    colorNeutral: '#E2E8F0',
    fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
    borderRadius: '12px'
  },
  elements: {
    card: { backgroundColor: '#1C2540', boxShadow: 'none', border: '1px solid rgba(6, 214, 160, 0.25)' },
    headerTitle: { color: '#FFFFFF' },
    headerSubtitle: { color: '#AAB6CA' },
    formFieldLabel: { color: '#FFFFFF' },
    formFieldInput: { backgroundColor: '#0B132B', color: '#FFFFFF', borderColor: '#53617D' },
    formButtonPrimary: { backgroundColor: '#06D6A0', color: '#0B132B' },
    socialButtonsBlockButtonText: { color: '#FFFFFF' },
    footerActionText: { color: '#AAB6CA' },
    footerActionLink: { color: '#06D6A0' },
    dividerText: { color: '#AAB6CA' }
  }
};

function renderHeader(clerk) {
  const signInLink = document.getElementById('signInLink');
  const signUpLink = document.getElementById('signUpLink');
  const userLabel = document.getElementById('authUser');
  const accountButton = document.getElementById('accountBtn');
  const signOutButton = document.getElementById('signOutBtn');
  if (!signInLink || !signUpLink || !userLabel || !accountButton || !signOutButton) return;

  const user = clerk.user;
  signInLink.hidden = Boolean(user);
  signUpLink.hidden = Boolean(user);
  userLabel.hidden = !user;
  accountButton.hidden = !user;
  signOutButton.hidden = !user;
  userLabel.textContent = user?.fullName || user?.primaryEmailAddress?.emailAddress || '';
}

function announceAuthState(clerk) {
  window.dispatchEvent(new CustomEvent('draftfield:auth-ready', {
    detail: { signedIn: Boolean(clerk.user) }
  }));
}

function showError(message) {
  const status = document.getElementById('authStatus');
  if (status) status.textContent = message;
  console.error('Authentication setup failed:', message);
}

async function initializeAuth() {
  try {
    const response = await fetch('/api/auth/config', { credentials: 'same-origin' });
    const config = await response.json();
    if (!response.ok || !config.publishableKey) {
      throw new Error('Account sign-in is not configured. Please try again later.');
    }

    const clerk = new Clerk(config.publishableKey, { proxyUrl: config.proxyUrl || '' });
    await clerk.load({
      ui,
      appearance,
      signInUrl: '/sign-in',
      signUpUrl: '/sign-up',
      signInFallbackRedirectUrl: '/',
      signUpFallbackRedirectUrl: '/',
      afterSignOutUrl: '/'
    });
    window.draftFieldClerk = clerk;
    renderHeader(clerk);
    announceAuthState(clerk);
    clerk.addListener(() => {
      renderHeader(clerk);
      announceAuthState(clerk);
    });

    const mount = document.getElementById('clerkMount');
    if (mount) {
      if (window.location.pathname.startsWith('/sign-up')) {
        document.getElementById('authTitle').textContent = 'Create your account';
        document.getElementById('authDescription').textContent = 'Sign up to access your Draft & Field Hub account.';
        clerk.mountSignUp(mount, {
          routing: 'path',
          path: '/sign-up',
          signInUrl: '/sign-in',
          fallbackRedirectUrl: '/',
          appearance
        });
      } else {
        document.getElementById('authTitle').textContent = 'Welcome back';
        document.getElementById('authDescription').textContent = 'Log in to your Draft & Field Hub account.';
        clerk.mountSignIn(mount, {
          routing: 'path',
          path: '/sign-in',
          signUpUrl: '/sign-up',
          fallbackRedirectUrl: '/',
          appearance
        });
      }
    }

    const accountButton = document.getElementById('accountBtn');
    accountButton?.addEventListener('click', () => clerk.openUserProfile());
    const signOutButton = document.getElementById('signOutBtn');
    signOutButton?.addEventListener('click', async () => {
      signOutButton.disabled = true;
      try {
        await clerk.signOut({ redirectUrl: '/' });
      } catch (error) {
        showError(error.message || 'Could not log out. Please try again.');
      } finally {
        signOutButton.disabled = false;
      }
    });
  } catch (error) {
    showError(error.message || 'Could not load account sign-in.');
  }
}

initializeAuth();
