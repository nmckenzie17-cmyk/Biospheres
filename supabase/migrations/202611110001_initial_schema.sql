-- XenoWorld initial schema. Apply with `supabase db push` or the Supabase SQL editor.
create extension if not exists pgcrypto;

create type public.user_role as enum ('student', 'teacher');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role public.user_role not null default 'student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.classrooms (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  join_code text not null unique default upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.classroom_members (
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (classroom_id, student_id),
  unique (student_id, classroom_id)
);

create table public.planets (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  description text not null default '',
  image_path text,
  atmosphere jsonb not null default '{}'::jsonb,
  temperature jsonb not null default '{}'::jsonb,
  gravity numeric,
  water_availability text,
  terrain jsonb not null default '[]'::jsonb,
  environmental_conditions jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, classroom_id)
);

create table public.student_planets (
  id uuid primary key default gen_random_uuid(),
  source_planet_id uuid not null,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text not null default '',
  image_path text,
  atmosphere jsonb not null default '{}'::jsonb,
  temperature jsonb not null default '{}'::jsonb,
  gravity numeric,
  water_availability text,
  terrain jsonb not null default '[]'::jsonb,
  environmental_conditions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, classroom_id),
  unique (id, student_id),
  foreign key (source_planet_id, classroom_id) references public.planets(id, classroom_id) on delete restrict,
  foreign key (classroom_id, student_id) references public.classroom_members(classroom_id, student_id) on delete cascade
);

create table public.species (
  id uuid primary key default gen_random_uuid(),
  planet_id uuid not null,
  student_id uuid not null,
  parent_species_id uuid references public.species(id) on delete restrict,
  name text not null,
  image_path text,
  description text not null default '',
  characteristics jsonb not null default '{}'::jsonb,
  body_structure text not null default '',
  locomotion text not null default '',
  diet text not null default '',
  habitat text not null default '',
  reproduction text not null default '',
  lifespan text not null default '',
  population bigint,
  predators jsonb not null default '[]'::jsonb,
  defensive_adaptations jsonb not null default '[]'::jsonb,
  environmental_tolerances jsonb not null default '{}'::jsonb,
  evolutionary_changes text not null default '',
  student_notes text not null default '',
  generation integer not null default 0 check (generation >= 0),
  is_extinct boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, planet_id),
  foreign key (planet_id, student_id) references public.student_planets(id, student_id) on delete cascade,
  foreign key (parent_species_id, planet_id) references public.species(id, planet_id) on delete restrict
);

create table public.evolutionary_relationships (
  parent_species_id uuid not null,
  child_species_id uuid not null unique,
  planet_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (parent_species_id, child_species_id),
  foreign key (parent_species_id, planet_id) references public.species(id, planet_id) on delete cascade,
  foreign key (child_species_id, planet_id) references public.species(id, planet_id) on delete cascade,
  check (parent_species_id <> child_species_id)
);

create table public.species_events (
  id uuid primary key default gen_random_uuid(),
  planet_id uuid not null references public.student_planets(id) on delete cascade,
  species_id uuid references public.species(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.environmental_events (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  description text not null default '',
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  target_planet_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.extinction_events (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  species_id uuid not null references public.species(id) on delete restrict,
  planet_id uuid not null references public.student_planets(id) on delete restrict,
  reason text not null default '',
  restored_at timestamptz,
  restored_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (species_id, planet_id) references public.species(id, planet_id) on delete restrict
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  lesson_number text,
  description text not null default '',
  instructions text not null default '',
  image_path text,
  target_student_ids uuid[],
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  announcement_id uuid references public.announcements(id) on delete cascade,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  description text not null default '',
  species_id uuid references public.species(id) on delete set null,
  mode text not null check (mode in ('specific', 'random', 'student_choice')),
  target_student_ids uuid[],
  due_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid references public.classrooms(id) on delete cascade,
  student_id uuid references public.profiles(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index classroom_members_student_idx on public.classroom_members(student_id);
create index planets_classroom_idx on public.planets(classroom_id);
create index student_planets_classroom_idx on public.student_planets(classroom_id);
create index species_planet_created_idx on public.species(planet_id, created_at);
create index species_parent_idx on public.species(parent_species_id);
create index species_student_idx on public.species(student_id);
create index notifications_student_created_idx on public.notifications(student_id, created_at desc);
create index activity_logs_classroom_created_idx on public.activity_logs(classroom_id, created_at desc);
create index environmental_events_classroom_created_idx on public.environmental_events(classroom_id, created_at desc);

-- New Auth users always start as students. Role changes are reserved for service/admin operations.
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''), 'student');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create function public.protect_profile_role() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'Profile role can only be changed by a privileged server operation';
  end if;
  return new;
end;
$$;
create trigger profile_role_guard before update on public.profiles for each row execute procedure public.protect_profile_role();

create function public.is_classroom_teacher(classroom uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.classrooms c
    where c.id = classroom and c.teacher_id = (select auth.uid())
  )
$$;

create function public.is_classroom_student(classroom uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.classroom_members cm
    where cm.classroom_id = classroom and cm.student_id = (select auth.uid())
  )
$$;

alter table public.profiles enable row level security;
alter table public.classrooms enable row level security;
alter table public.classroom_members enable row level security;
alter table public.planets enable row level security;
alter table public.student_planets enable row level security;
alter table public.species enable row level security;
alter table public.evolutionary_relationships enable row level security;
alter table public.species_events enable row level security;
alter table public.environmental_events enable row level security;
alter table public.extinction_events enable row level security;
alter table public.announcements enable row level security;
alter table public.notifications enable row level security;
alter table public.assignments enable row level security;
alter table public.activity_logs enable row level security;

-- Grants allow the authenticated Data API role to reach these tables; RLS below
-- remains the row-level security boundary. Do not grant anonymous access.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

create policy "profiles select self or classroom teacher" on public.profiles for select to authenticated
using (id = (select auth.uid()) or exists (
  select 1 from public.classroom_members cm join public.classrooms c on c.id = cm.classroom_id
  where cm.student_id = profiles.id and c.teacher_id = (select auth.uid())
));
create policy "profiles update self non-role fields" on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "classroom teacher manages classroom" on public.classrooms for all to authenticated
using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
create policy "student sees own memberships" on public.classroom_members for select to authenticated
using (student_id = (select auth.uid()) or public.is_classroom_teacher(classroom_id));
create policy "teacher manages classroom members" on public.classroom_members for all to authenticated
using (public.is_classroom_teacher(classroom_id)) with check (public.is_classroom_teacher(classroom_id));

create policy "classroom users read source planets" on public.planets for select to authenticated
using (public.is_classroom_teacher(classroom_id) or public.is_classroom_student(classroom_id));
create policy "teacher manages source planets" on public.planets for all to authenticated
using (public.is_classroom_teacher(classroom_id)) with check (public.is_classroom_teacher(classroom_id));

create policy "students and teacher read student planets" on public.student_planets for select to authenticated
using (student_id = (select auth.uid()) or public.is_classroom_teacher(classroom_id));
create policy "student manages own planet" on public.student_planets for update to authenticated
using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy "teacher manages student planets" on public.student_planets for all to authenticated
using (public.is_classroom_teacher(classroom_id)) with check (public.is_classroom_teacher(classroom_id));

create policy "student and teacher read species" on public.species for select to authenticated
using (student_id = (select auth.uid()) or exists(select 1 from public.student_planets sp where sp.id = species.planet_id and public.is_classroom_teacher(sp.classroom_id)));
create policy "student inserts own species" on public.species for insert to authenticated
with check (student_id = (select auth.uid()) and exists(select 1 from public.student_planets sp where sp.id = planet_id and sp.student_id = (select auth.uid())));
create policy "student updates own species" on public.species for update to authenticated
using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy "teacher manages class species" on public.species for all to authenticated
using (exists(select 1 from public.student_planets sp where sp.id = species.planet_id and public.is_classroom_teacher(sp.classroom_id)))
with check (exists(select 1 from public.student_planets sp where sp.id = species.planet_id and public.is_classroom_teacher(sp.classroom_id)));

create policy "read evolutionary links in accessible worlds" on public.evolutionary_relationships for select to authenticated
using (exists(select 1 from public.species s where s.id = child_species_id and (s.student_id = (select auth.uid()) or exists(select 1 from public.student_planets sp where sp.id = s.planet_id and public.is_classroom_teacher(sp.classroom_id)))));
create policy "students insert own evolutionary links" on public.evolutionary_relationships for insert to authenticated
with check (exists(select 1 from public.species s where s.id = child_species_id and s.student_id = (select auth.uid())));
create policy "read species events" on public.species_events for select to authenticated
using (exists(select 1 from public.student_planets sp where sp.id = planet_id and (sp.student_id = (select auth.uid()) or public.is_classroom_teacher(sp.classroom_id))));
create policy "teachers write species events" on public.species_events for insert to authenticated
with check (exists(select 1 from public.student_planets sp where sp.id = planet_id and public.is_classroom_teacher(sp.classroom_id)));

create policy "classroom members read environmental events" on public.environmental_events for select to authenticated
using (public.is_classroom_teacher(classroom_id) or public.is_classroom_student(classroom_id));
create policy "teachers manage environmental events" on public.environmental_events for all to authenticated
using (public.is_classroom_teacher(classroom_id)) with check (public.is_classroom_teacher(classroom_id));
create policy "classroom members read extinction history" on public.extinction_events for select to authenticated
using (public.is_classroom_teacher(classroom_id) or exists(select 1 from public.student_planets sp where sp.id = planet_id and sp.student_id = (select auth.uid())));
create policy "teachers manage extinction history" on public.extinction_events for all to authenticated
using (public.is_classroom_teacher(classroom_id)) with check (public.is_classroom_teacher(classroom_id));
create policy "classroom members read announcements" on public.announcements for select to authenticated
using (public.is_classroom_teacher(classroom_id) or (public.is_classroom_student(classroom_id) and published_at is not null and (target_student_ids is null or (select auth.uid()) = any(target_student_ids))));
create policy "teachers manage announcements" on public.announcements for all to authenticated
using (public.is_classroom_teacher(classroom_id)) with check (public.is_classroom_teacher(classroom_id));
create policy "students read own notifications" on public.notifications for select to authenticated
using (student_id = (select auth.uid()) or public.is_classroom_teacher(classroom_id));
create policy "students update own notifications" on public.notifications for update to authenticated
using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy "teachers manage notifications" on public.notifications for all to authenticated
using (public.is_classroom_teacher(classroom_id)) with check (public.is_classroom_teacher(classroom_id));
create policy "classroom members read assignments" on public.assignments for select to authenticated
using (public.is_classroom_teacher(classroom_id) or (public.is_classroom_student(classroom_id) and (target_student_ids is null or (select auth.uid()) = any(target_student_ids))));
create policy "teachers manage assignments" on public.assignments for all to authenticated
using (public.is_classroom_teacher(classroom_id)) with check (public.is_classroom_teacher(classroom_id));
create policy "users read relevant activity" on public.activity_logs for select to authenticated
using (actor_id = (select auth.uid()) or student_id = (select auth.uid()) or (classroom_id is not null and public.is_classroom_teacher(classroom_id)));
create policy "users insert own activity" on public.activity_logs for insert to authenticated
with check (actor_id = (select auth.uid()) or student_id = (select auth.uid()));

-- Private image bucket. Paths must start with the uploader's auth UUID.
insert into storage.buckets (id, name, public) values ('xenoworld-images', 'xenoworld-images', false)
on conflict (id) do nothing;
create policy "authenticated users read world images" on storage.objects for select to authenticated
using (bucket_id = 'xenoworld-images');
create policy "upload to personal image folder" on storage.objects for insert to authenticated
with check (bucket_id = 'xenoworld-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "owners update personal image folder" on storage.objects for update to authenticated
using (bucket_id = 'xenoworld-images' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'xenoworld-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
