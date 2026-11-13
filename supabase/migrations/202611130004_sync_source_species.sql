alter table public.species
  add column if not exists source_species_id uuid references public.planet_species(id) on delete set null;

-- Link existing generation-zero copies to the template that created them.
update public.species s
set source_species_id = ps.id
from public.student_planets sp
join public.planet_species ps on ps.planet_id = sp.source_planet_id
where s.planet_id = sp.id
  and s.generation = 0
  and s.name = ps.name
  and s.source_species_id is null;

create or replace function public.teacher_update_source_species(p_source_species_id uuid, p_changes jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_planet_id uuid; v_classroom_id uuid; v_copies integer;
begin
  select p.id, p.classroom_id into v_planet_id, v_classroom_id
  from public.planet_species ps
  join public.planets p on p.id = ps.planet_id
  where ps.id = p_source_species_id
    and p.created_by = auth.uid()
    and public.is_classroom_teacher(p.classroom_id);
  if v_planet_id is null then raise exception 'Original species was not found in your classroom'; end if;

  update public.planet_species set
    name = case when p_changes ? 'name' then coalesce(nullif(trim(p_changes->>'name'), ''), name) else name end,
    description = case when p_changes ? 'description' then coalesce(p_changes->>'description', '') else description end,
    image_path = case when p_changes ? 'image_path' then p_changes->>'image_path' else image_path end,
    characteristics = case when p_changes ? 'characteristics' then p_changes->'characteristics' else characteristics end,
    body_structure = case when p_changes ? 'body_structure' then coalesce(p_changes->>'body_structure', '') else body_structure end,
    locomotion = case when p_changes ? 'locomotion' then coalesce(p_changes->>'locomotion', '') else locomotion end,
    diet = case when p_changes ? 'diet' then coalesce(p_changes->>'diet', '') else diet end,
    habitat = case when p_changes ? 'habitat' then coalesce(p_changes->>'habitat', '') else habitat end,
    reproduction = case when p_changes ? 'reproduction' then coalesce(p_changes->>'reproduction', '') else reproduction end,
    lifespan = case when p_changes ? 'lifespan' then coalesce(p_changes->>'lifespan', '') else lifespan end,
    population = case when p_changes ? 'population' then nullif(p_changes->>'population', '')::bigint else population end,
    predators = case when p_changes ? 'predators' then p_changes->'predators' else predators end,
    defensive_adaptations = case when p_changes ? 'defensive_adaptations' then p_changes->'defensive_adaptations' else defensive_adaptations end,
    environmental_tolerances = case when p_changes ? 'environmental_tolerances' then p_changes->'environmental_tolerances' else environmental_tolerances end
  where id = p_source_species_id;

  update public.species set
    name = case when p_changes ? 'name' then coalesce(nullif(trim(p_changes->>'name'), ''), name) else name end,
    description = case when p_changes ? 'description' then coalesce(p_changes->>'description', '') else description end,
    image_path = case when p_changes ? 'image_path' then p_changes->>'image_path' else image_path end,
    characteristics = case when p_changes ? 'characteristics' then p_changes->'characteristics' else characteristics end,
    body_structure = case when p_changes ? 'body_structure' then coalesce(p_changes->>'body_structure', '') else body_structure end,
    locomotion = case when p_changes ? 'locomotion' then coalesce(p_changes->>'locomotion', '') else locomotion end,
    diet = case when p_changes ? 'diet' then coalesce(p_changes->>'diet', '') else diet end,
    habitat = case when p_changes ? 'habitat' then coalesce(p_changes->>'habitat', '') else habitat end,
    reproduction = case when p_changes ? 'reproduction' then coalesce(p_changes->>'reproduction', '') else reproduction end,
    lifespan = case when p_changes ? 'lifespan' then coalesce(p_changes->>'lifespan', '') else lifespan end,
    population = case when p_changes ? 'population' then nullif(p_changes->>'population', '')::bigint else population end,
    predators = case when p_changes ? 'predators' then p_changes->'predators' else predators end,
    defensive_adaptations = case when p_changes ? 'defensive_adaptations' then p_changes->'defensive_adaptations' else defensive_adaptations end,
    environmental_tolerances = case when p_changes ? 'environmental_tolerances' then p_changes->'environmental_tolerances' else environmental_tolerances end
  where source_species_id = p_source_species_id
    and exists(select 1 from public.student_planets sp where sp.id = species.planet_id and sp.classroom_id = v_classroom_id);
  get diagnostics v_copies = row_count;
  return v_copies;
end;
$$;
grant execute on function public.teacher_update_source_species(uuid, jsonb) to authenticated;

-- Keep source-template references on all seed species created by future distributions.
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
    planet_id, student_id, source_species_id, name, image_path, description, characteristics, body_structure,
    locomotion, diet, habitat, reproduction, lifespan, population, predators,
    defensive_adaptations, environmental_tolerances, generation
  )
  select inserted.id, inserted.student_id, ps.id, ps.name, ps.image_path, ps.description, ps.characteristics,
    ps.body_structure, ps.locomotion, ps.diet, ps.habitat, ps.reproduction, ps.lifespan,
    ps.population, ps.predators, ps.defensive_adaptations, ps.environmental_tolerances, 0
  from inserted cross join public.planet_species ps where ps.planet_id = source_id;

  get diagnostics v_count = row_count;
  return v_count / (select count(*) from public.planet_species ps where ps.planet_id = source_id);
end;
$$;
grant execute on function public.distribute_classroom_planet(uuid) to authenticated;
