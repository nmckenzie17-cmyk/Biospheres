alter table public.planets add column if not exists planet_details jsonb not null default '[]'::jsonb;
alter table public.student_planets add column if not exists planet_details jsonb not null default '[]'::jsonb;
alter table public.planets drop constraint if exists planets_planet_details_array_check;
alter table public.planets add constraint planets_planet_details_array_check check (jsonb_typeof(planet_details) = 'array');
alter table public.student_planets drop constraint if exists student_planets_planet_details_array_check;
alter table public.student_planets add constraint student_planets_planet_details_array_check check (jsonb_typeof(planet_details) = 'array');

create or replace function public.add_planet_detail(p_source_planet_id uuid, p_title text, p_description text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_classroom_id uuid; v_fact jsonb; v_copies integer;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if nullif(trim(p_title), '') is null or nullif(trim(p_description), '') is null then
    raise exception 'A title and description are required';
  end if;
  select p.classroom_id into v_classroom_id from public.planets p
    where p.id = p_source_planet_id and p.created_by = auth.uid() and public.is_classroom_teacher(p.classroom_id);
  if v_classroom_id is null then raise exception 'Source planet was not found in your classroom'; end if;
  v_fact := pg_catalog.jsonb_build_object('title', trim(p_title), 'description', trim(p_description));
  update public.planets set planet_details = planet_details || pg_catalog.jsonb_build_array(v_fact)
    where id = p_source_planet_id;
  update public.student_planets set planet_details = planet_details || pg_catalog.jsonb_build_array(v_fact)
    where source_planet_id = p_source_planet_id and classroom_id = v_classroom_id;
  get diagnostics v_copies = row_count;
  return v_copies;
end;
$$;
grant execute on function public.add_planet_detail(uuid, text, text) to authenticated;

-- Ensure any future copies include the flexible facts on the source planet.
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
      temperature, gravity, water_availability, terrain, environmental_conditions, planet_details
    )
    select p.id, p.classroom_id, cm.student_id, p.name, p.description, p.image_path, p.atmosphere,
      p.temperature, p.gravity, p.water_availability, p.terrain, p.environmental_conditions, p.planet_details
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
