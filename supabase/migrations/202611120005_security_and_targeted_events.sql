-- Forward update for projects that already applied the first XenoWorld migrations.

-- A user must have a teacher profile role as well as classroom ownership.
create or replace function public.is_classroom_teacher(classroom uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.classrooms c join public.profiles p on p.id = c.teacher_id
    where c.id = classroom and c.teacher_id = (select auth.uid()) and p.role = 'teacher'
  )
$$;
drop policy if exists "classroom teacher manages classroom" on public.classrooms;
create policy "classroom teacher manages classroom" on public.classrooms for all to authenticated
using (teacher_id = (select auth.uid()) and exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'teacher'))
with check (teacher_id = (select auth.uid()) and exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'teacher'));

-- Keep student species append-only, and derive generation from the verified parent.
drop policy if exists "student updates own species" on public.species;
drop policy if exists "student inserts own species" on public.species;
drop policy if exists "student inserts descendants on own planet" on public.species;
create policy "student inserts descendants on own planet" on public.species for insert to authenticated
with check (
  student_id = (select auth.uid()) and parent_species_id is not null
  and exists(select 1 from public.student_planets sp where sp.id = planet_id and sp.student_id = (select auth.uid()))
);
create or replace function public.set_species_generation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_parent record;
begin
  if new.parent_species_id is null then
    if new.generation <> 0 then raise exception 'A root species must be generation zero'; end if;
    return new;
  end if;
  select s.planet_id, s.student_id, s.generation into v_parent from public.species s where s.id = new.parent_species_id;
  if not found or v_parent.planet_id <> new.planet_id or v_parent.student_id <> new.student_id then
    raise exception 'Parent species must belong to this student planet';
  end if;
  new.generation := v_parent.generation + 1;
  return new;
end;
$$;
drop trigger if exists set_species_generation_before_insert on public.species;
create trigger set_species_generation_before_insert before insert on public.species
for each row execute procedure public.set_species_generation();

-- Restrict private image reads to objects referenced by a visible source or student world.
drop policy if exists "authenticated users read world images" on storage.objects;
drop policy if exists "read referenced classroom images" on storage.objects;
create policy "read referenced classroom images" on storage.objects for select to authenticated
using (
  bucket_id = 'xenoworld-images' and (
    exists(select 1 from public.student_planets sp where sp.image_path = objects.name and
      (sp.student_id = (select auth.uid()) or public.is_classroom_teacher(sp.classroom_id)))
    or exists(select 1 from public.species s where s.image_path = objects.name and
      (s.student_id = (select auth.uid()) or exists(select 1 from public.student_planets sp where sp.id = s.planet_id and public.is_classroom_teacher(sp.classroom_id))))
    or exists(select 1 from public.planets p where p.image_path = objects.name and
      (public.is_classroom_teacher(p.classroom_id) or public.is_classroom_student(p.classroom_id)))
    or exists(select 1 from public.planet_species ps join public.planets p on p.id = ps.planet_id where ps.image_path = objects.name and
      (public.is_classroom_teacher(p.classroom_id) or public.is_classroom_student(p.classroom_id)))
  )
);

-- Replace the original class-wide RPC with a version that can target selected students.
drop function if exists public.apply_classroom_event(uuid, text, text, text, jsonb);
create or replace function public.apply_classroom_event(
  p_classroom_id uuid, p_name text, p_description text, p_event_type text, p_payload jsonb default '{}'::jsonb,
  p_target_student_ids uuid[] default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_targets uuid[];
begin
  if not public.is_classroom_teacher(p_classroom_id) then raise exception 'Teacher access required for this classroom'; end if;
  if p_target_student_ids is not null and exists(
    select 1 from pg_catalog.unnest(p_target_student_ids) as u(student_id)
    where not exists(select 1 from public.classroom_members cm where cm.classroom_id = p_classroom_id and cm.student_id = u.student_id)
  ) then raise exception 'Every selected student must belong to this classroom'; end if;
  select coalesce(array_agg(id), '{}'::uuid[]) into v_targets from public.student_planets
    where classroom_id = p_classroom_id and (p_target_student_ids is null or student_id = any(p_target_student_ids));
  update public.student_planets set
    environmental_conditions = environmental_conditions ||
      pg_catalog.jsonb_build_object('active_event', p_name, 'event_type', p_event_type, 'description', p_description, 'payload', coalesce(p_payload, '{}'::jsonb), 'occurred_at', pg_catalog.now()),
    temperature = case when p_event_type = 'temperature' then temperature || pg_catalog.jsonb_build_object('event_change', p_payload -> 'magnitude') else temperature end,
    atmosphere = case when p_event_type = 'atmosphere' then atmosphere || pg_catalog.jsonb_build_object('event_change', p_payload -> 'magnitude') else atmosphere end,
    water_availability = case when p_event_type = 'water' then pg_catalog.concat_ws(' · ', nullif(water_availability,''), p_name, p_payload ->> 'magnitude') else water_availability end
    where classroom_id = p_classroom_id and (p_target_student_ids is null or student_id = any(p_target_student_ids));
  insert into public.environmental_events(classroom_id, teacher_id, name, description, event_type, event_data, target_planet_ids)
    values(p_classroom_id, auth.uid(), p_name, p_description, p_event_type, coalesce(p_payload, '{}'::jsonb), v_targets)
    returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.apply_classroom_event(uuid, text, text, text, jsonb, uuid[]) to authenticated;

-- Enable student live updates for affected worlds and teacher extinction changes.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'environmental_events') then
    execute 'alter publication supabase_realtime add table public.environmental_events';
  end if;
  if not exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'species') then
    execute 'alter publication supabase_realtime add table public.species';
  end if;
end;
$$;
