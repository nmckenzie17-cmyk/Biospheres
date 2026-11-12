import { supabase } from './supabase.js';

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}${window.location.pathname}` },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut({ scope: 'global' });
  if (!error) return;
  // A rejected/expired server session can reject global revocation. Always
  // clear the current browser session so the user is not trapped signed in.
  const { error: localError } = await supabase.auth.signOut({ scope: 'local' });
  if (localError) throw localError;
}

export async function getProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('id, display_name, role').eq('id', userId).single();
  if (error) throw error;
  return data;
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/index.html?password-reset=1`,
  });
  if (error) throw error;
}
