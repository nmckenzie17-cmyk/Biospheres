import { getProfile, sendPasswordReset, signIn, signInWithGoogle, signOut } from './auth.js';
import { isSupabaseConfigured, supabase } from './supabase.js';
import './styles.css';
import './google.css';

const app = document.querySelector('#app');

function shell({ teacher, eyebrow, title, description, content }) {
  document.body.dataset.portal = teacher ? 'teacher' : 'student';
  app.innerHTML = `
    <main class="layout">
      <section class="visual-panel" aria-label="XenoWorld environment">
        <div class="orbital orbital-one"></div><div class="orbital orbital-two"></div>
        <div class="planet"><span></span></div>
        <div class="visual-caption"><span class="status-dot"></span> ${teacher ? 'PLANETARY CONTROL NETWORK' : 'FIELD RESEARCH NETWORK'}<br><strong>${teacher ? 'GOD MODE // SYSTEM READY' : 'XENOBIOLOGY // FIELD TERMINAL'}</strong></div>
      </section>
      <section class="access-panel">
        <header class="brand"><span class="brand-mark">X</span><span>XENOWORLD<small>${teacher ? 'EDUCATOR CONTROL' : 'STUDENT PORTAL'}</small></span></header>
        <div class="access-content">
          <p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="intro">${description}</p>
          ${content}
          <div class="system-note"><span class="lock">▣</span> Secure access · Supabase identity verification</div>
        </div>
        <footer>EXOWORLD RESEARCH INITIATIVE <span>BUILD 01.0</span></footer>
      </section>
    </main>`;
}

function showConfigMessage() {
  shell({
    teacher: location.pathname.startsWith('/teacher/'), eyebrow: 'SYSTEM CONFIGURATION',
    title: 'Connection pending.',
    description: 'Add your Supabase project URL and public key to the local environment to activate secure sign in.',
    content: '<div class="config-card"><strong>Required environment</strong><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_ANON_KEY</code><p>Copy <code>.env.example</code> to <code>.env</code>, enter the project values, then restart the development server.</p></div>',
  });
}

export async function startPortal({ teacher }) {
  const role = teacher ? 'teacher' : 'student';
  if (!isSupabaseConfigured) return showConfigMessage();

  const renderLogin = (message = '') => shell({
    teacher,
    eyebrow: teacher ? 'AUTHORIZED PERSONNEL ONLY' : 'WELCOME BACK, RESEARCHER',
    title: teacher ? 'Take the controls.' : 'Return to your world.',
    description: teacher ? 'Sign in with your educator account to access classroom systems.' : 'Sign in to continue exploring your planet and its evolving life.',
    content: `<button id="google-login" class="google-button" type="button"><span class="google-g">G</span> Continue with Google</button>
      <div class="login-divider"><span>OR SIGN IN WITH EMAIL</span></div>
      <form id="login-form" class="login-form">
      <label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" placeholder="name@school.edu" required />
      <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required />
      <div class="form-message" role="status">${message}</div>
      <button class="primary-button" type="submit"><span>${teacher ? 'ACCESS CONTROL CENTRE' : 'ENTER MY PLANET'}</span><b>→</b></button>
      <button id="reset-password" class="text-button" type="button">Forgot your password?</button>
    </form>
    ${teacher ? '<a class="portal-link" href="/index.html">Student portal <span>↗</span></a>' : '<a class="portal-link" href="/teacher/index.html">Educator access <span>↗</span></a>'}`,
  });

  const renderSession = async (user) => {
    try {
      const profile = await getProfile(user.id);
      if (teacher && profile.role !== 'teacher') {
        await signOut();
        window.location.replace('/index.html?access=denied');
        return;
      }
      if (!teacher && profile.role === 'teacher') {
        app.innerHTML = `<main class="session-screen"><div class="session-card"><span class="brand-mark">X</span><p class="eyebrow">EDUCATOR IDENTITY VERIFIED</p><h1>Welcome, ${escapeHtml(profile.display_name || user.email)}.</h1><p>Your student portal is available, along with your classroom controls.</p><a class="primary-button anchor-button" href="/teacher/index.html">OPEN TEACHER CONTROL CENTRE <b>→</b></a><button id="sign-out" class="text-button">Sign out</button></div></main>`;
        app.querySelector('#sign-out').addEventListener('click', signOut);
        return;
      }
      const { data: planets, error } = await supabase.from('student_planets').select('id, name, description').eq('student_id', user.id).limit(1);
      if (error) throw error;
      const planet = planets?.[0];
      app.innerHTML = `<main class="session-screen"><div class="session-card"><span class="brand-mark">X</span><p class="eyebrow">RESEARCHER ID VERIFIED</p><h1>${escapeHtml(planet?.name || 'Your planet awaits.')}</h1><p>${escapeHtml(planet?.description || 'Your personal world will appear here once your teacher distributes the classroom planet.')}</p><div class="empty-world">${planet ? 'PLANET DATA CONNECTED · SPECIES EXPLORATION COMING ONLINE' : 'AWAITING CLASSROOM PLANET DISTRIBUTION'}</div><button id="sign-out" class="text-button">Sign out</button></div></main>`;
      app.querySelector('#sign-out').addEventListener('click', signOut);
    } catch (error) {
      await signOut();
      renderLogin(error.message || 'Your account profile could not be loaded.');
    }
  };

  const { data: { session } } = await supabase.auth.getSession();
  if (session) await renderSession(session.user);
  else renderLogin(new URLSearchParams(location.search).has('access') ? 'Teacher access requires a teacher account.' : '');

  supabase.auth.onAuthStateChange((_event, nextSession) => {
    if (nextSession) renderSession(nextSession.user);
    else renderLogin();
  });

  app.addEventListener('submit', async (event) => {
    if (event.target.id !== 'login-form') return;
    event.preventDefault();
    const form = new FormData(event.target);
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    try { await signIn(form.get('email'), form.get('password')); }
    catch (error) { renderLogin(error.message || 'Sign in failed. Check your email and password.'); }
    finally { button.disabled = false; }
  });

  app.addEventListener('click', async (event) => {
    if (event.target.closest('#google-login')) {
      const button = app.querySelector('#google-login');
      button.disabled = true;
      try { await signInWithGoogle(); }
      catch (error) {
        button.disabled = false;
        app.querySelector('.form-message').textContent = error.message || 'Google sign in failed.';
      }
    }
    if (event.target.id === 'reset-password') {
      const email = app.querySelector('#email').value;
      if (!email) { app.querySelector('.form-message').textContent = 'Enter your email address first.'; return; }
      try { await sendPasswordReset(email); app.querySelector('.form-message').textContent = 'Password reset instructions sent if this account exists.'; }
      catch (error) { app.querySelector('.form-message').textContent = error.message; }
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
