-- Teacher-authored species templates live with the classroom's source planet.
create table public.planet_species (
  id uuid primary key default gen_random_uuid(),
  planet_id uuid not null references public.planets(id) on delete cascade,
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
  created_at timestamptz not null default now()
);
create index planet_species_planet_idx on public.planet_species(planet_id);
alter table public.planet_species enable row level security;
grant select, insert, update, delete on public.planet_species to authenticated;
create policy "classroom users read source species" on public.planet_species for select to authenticated
using (exists(select 1 from public.planets p where p.id = planet_id and (public.is_classroom_teacher(p.classroom_id) or public.is_classroom_student(p.classroom_id))));
create policy "teacher manages source species" on public.planet_species for all to authenticated
using (exists(select 1 from public.planets p where p.id = planet_id and public.is_classroom_teacher(p.classroom_id)))
with check (exists(select 1 from public.planets p where p.id = planet_id and public.is_classroom_teacher(p.classroom_id)));
create policy "classroom members read classroom header" on public.classrooms for select to authenticated
using (teacher_id = auth.uid() or public.is_classroom_student(id));

-- Student evolution is append-only: descendants may be added, while old entries
-- and extinction state cannot be edited through the public Data API.
drop policy if exists "student updates own species" on public.species;
drop policy if exists "student inserts own species" on public.species;
create policy "student inserts descendants on own planet" on public.species for insert to authenticated
with check (
  student_id = auth.uid() and parent_species_id is not null
  and exists(select 1 from public.student_planets sp where sp.id = planet_id and sp.student_id = auth.uid())
);

create or replace function public.set_species_generation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_parent record;
begin
  if new.parent_species_id is null then
    if new.generation <> 0 then raise exception 'A root species must be generation zero'; end if;
    return new;
  end if;
  select s.planet_id, s.student_id, s.generation into v_parent
    from public.species s where s.id = new.parent_species_id;
  if not found or v_parent.planet_id <> new.planet_id or v_parent.student_id <> new.student_id then
    raise exception 'Parent species must belong to this student planet';
  end if;
  new.generation := v_parent.generation + 1;
  return new;
end;
$$;
create trigger set_species_generation_before_insert before insert on public.species
for each row execute procedure public.set_species_generation();

-- Enforce actual teacher role in database policies, including classroom creation.
create or replace function public.is_classroom_teacher(classroom uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.classrooms c join public.profiles p on p.id = c.teacher_id
    where c.id = classroom and c.teacher_id = (select auth.uid()) and p.role = 'teacher'
  )
$$;
drop policy "classroom teacher manages classroom" on public.classrooms;
create policy "classroom teacher manages classroom" on public.classrooms for all to authenticated
using (teacher_id = auth.uid() and exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'))
with check (teacher_id = auth.uid() and exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'teacher'));

-- A private bucket should expose only objects referenced by the caller's world
-- or a source planet visible to their classroom, not every authenticated user.
drop policy if exists "authenticated users read world images" on storage.objects;
create policy "read referenced classroom images" on storage.objects for select to authenticated
using (
  bucket_id = 'xenoworld-images' and (
    exists(select 1 from public.student_planets sp where sp.image_path = objects.name and
      (sp.student_id = auth.uid() or public.is_classroom_teacher(sp.classroom_id)))
    or exists(select 1 from public.species s where s.image_path = objects.name and
      (s.student_id = auth.uid() or exists(select 1 from public.student_planets sp where sp.id = s.planet_id and public.is_classroom_teacher(sp.classroom_id))))
    or exists(select 1 from public.planets p where p.image_path = objects.name and
      (public.is_classroom_teacher(p.classroom_id) or public.is_classroom_student(p.classroom_id)))
    or exists(select 1 from public.planet_species ps join public.planets p on p.id = ps.planet_id where ps.image_path = objects.name and
      (public.is_classroom_teacher(p.classroom_id) or public.is_classroom_student(p.classroom_id)))
  )
);

-- Join codes are redeemed server-side; students cannot insert arbitrary memberships.
create or replace function public.join_classroom(class_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_classroom uuid;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if not exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student') then
    raise exception 'Only student accounts can join a classroom';
  end if;
  select c.id into v_classroom from public.classrooms c where upper(c.join_code) = upper(trim(class_code));
  if v_classroom is null then raise exception 'Class code not found'; end if;
  insert into public.classroom_members(classroom_id, student_id) values (v_classroom, auth.uid()) on conflict do nothing;
  return v_classroom;
end;
$$;
grant execute on function public.join_classroom(text) to authenticated;

-- One atomic operation creates isolated planet and species records for every current member.
create or replace function public.distribute_classroom_planet(source_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_classroom uuid; v_count integer;
begin
  select p.classroom_id into v_classroom from public.planets p
    where p.id = source_id and p.created_by = auth.uid() and public.is_classroom_teacher(p.classroom_id)
      and p.published_at is not null;
  if v_classroom is null then raise exception 'Published source planet was not found in your classroom'; end if;
  if (select count(*) from public.planet_species ps where ps.planet_id = source_id) < 2 then
    raise exception 'Add the two original species before distributing this planet';
  end if;

  with inserted as (
    insert into public.student_planets (
      source_planet_id, classroom_id, student_id, name, description, image_path, atmosphere,
      temperature, gravity, water_availability, terrain, environmental_conditions
    )
    select p.id, p.classroom_id, cm.student_id, p.name, p.description, p.image_path, p.atmosphere,
      p.temperature, p.gravity, p.water_availability, p.terrain, p.environmental_conditions
    from public.planets p join public.classroom_members cm on cm.classroom_id = p.classroom_id
    where p.id = source_id
    on conflict (student_id, classroom_id) do nothing
    returning id, student_id
  )
  insert into public.species (
    planet_id, student_id, name, image_path, description, characteristics, body_structure,
    locomotion, diet, habitat, reproduction, lifespan, population, predators,
    defensive_adaptations, environmental_tolerances, generation
  )
  select inserted.id, inserted.student_id, ps.name, ps.image_path, ps.description, ps.characteristics,
    ps.body_structure, ps.locomotion, ps.diet, ps.habitat, ps.reproduction, ps.lifespan,
    ps.population, ps.predators, ps.defensive_adaptations, ps.environmental_tolerances, 0
  from inserted cross join public.planet_species ps where ps.planet_id = source_id;

  get diagnostics v_count = row_count;
  return v_count / (select count(*) from public.planet_species ps where ps.planet_id = source_id);
end;
$$;
grant execute on function public.distribute_classroom_planet(uuid) to authenticated;
