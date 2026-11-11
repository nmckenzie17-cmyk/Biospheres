# XenoWorld

XenoWorld is a student alien evolution simulator with separate student and educator entry points backed by one Supabase project.

## Routes

- Student portal: `/index.html`
- Teacher control entry: `/teacher/index.html`

Both pages are independent Vite entry points and share the Supabase client and authentication service in `src/lib`.

## Supabase setup

1. Create one Supabase project and enable email/password authentication.
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` using the project's public URL and anon/publishable key. Never place a service role key in this app.
3. Apply `supabase/migrations/202611110001_initial_schema.sql` with the Supabase CLI (`supabase db push`) or the SQL editor.
4. Create the educator's Auth account, then promote that profile from the Supabase SQL editor using a trusted administrator session:

   ```sql
   update public.profiles set role = 'teacher' where id = 'AUTH_USER_UUID';
   ```

   New accounts are always assigned the student role. Role changes from the browser are rejected by a database trigger.
5. Run `npm install` and `npm run dev` for local development. Use `npm run build` to create the static `dist` output for deployment.

### Google sign-in setup

Google buttons are available on both portals. To activate them:

1. In Google Cloud Console, create an OAuth client ID with application type **Web application**. Configure the OAuth consent screen and add test users if the app is still in testing.
2. In Supabase **Authentication → Sign In / Providers → Google**, enable Google and enter the Google client ID and client secret. Copy the callback URL shown by Supabase.
3. In Google Cloud, add that exact Supabase callback URL as an **Authorized redirect URI**.
4. In Supabase **Authentication → URL Configuration**, set the Site URL and add `http://localhost:5173/**` to Redirect URLs. Add the deployed origin/pattern there when the app is hosted.
5. Restart `npm run dev`, then use **Continue with Google** on either portal.

Keep Google's client secret in Supabase's provider settings; it does not belong in `.env` or browser code. New Google accounts receive the student role. To authorize an educator, promote that Auth user's profile from the Supabase SQL editor after their first Google sign-in:

```sql
update public.profiles
set role = 'teacher'
where id = (select id from auth.users where email = 'teacher@school.edu');
```

The hosting provider must serve `/teacher/index.html` at that exact path. Deploy the built `dist` directory without rewriting the teacher route to the student document.

## Initial implementation scope

The current foundation provides Supabase email/password sign-in, password reset, profile role checks, the separate portal shells, and the initial relational schema/RLS policies for classrooms, planets, species, evolutionary links, events, announcements, assignments, notifications, activity, and private image storage. Students receive their profile automatically on Auth account creation. Classroom creation, planet distribution, species workflows, and the operational teacher dashboard are the next implementation stages.

## Security notes

- The teacher interface checks `profiles.role` after authentication and denies student accounts at `/teacher/index.html`.
- Student rows are scoped by `auth.uid()` and teacher policies are scoped through classroom ownership.
- Profiles default to student. Never promote teachers through user supplied signup metadata.
- Do not disable RLS or expose the service role key to the browser.
- The private `xenoworld-images` bucket currently permits authenticated reads; use short-lived signed URLs in the application when rendering private images.
