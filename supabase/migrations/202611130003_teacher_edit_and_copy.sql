alter table public.species add column if not exists copied_from_species_id uuid references public.species(id) on delete set null;

create or replace function public.teacher_update_source_planet(p_planet_id uuid, p_changes jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_classroom uuid; v_name text; v_description text; v_image_path text; v_atmosphere jsonb;
  v_temperature jsonb; v_gravity numeric; v_water text; v_terrain jsonb; v_copies integer;
begin
  select p.classroom_id into v_classroom from public.planets p
    where p.id = p_planet_id and p.created_by = auth.uid() and public.is_classroom_teacher(p.classroom_id);
  if v_classroom is null then raise exception 'Source planet was not found in your classroom'; end if;
  if p_changes ? 'name' then v_name := nullif(trim(p_changes->>'name'), ''); end if;
  if p_changes ? 'description' then v_description := p_changes->>'description'; end if;
  if p_changes ? 'image_path' then v_image_path := p_changes->>'image_path'; end if;
  if p_changes ? 'atmosphere' then v_atmosphere := p_changes->'atmosphere'; end if;
  if p_changes ? 'temperature' then v_temperature := p_changes->'temperature'; end if;
  if p_changes ? 'gravity' then v_gravity := nullif(p_changes->>'gravity','')::numeric; end if;
  if p_changes ? 'water_availability' then v_water := p_changes->>'water_availability'; end if;
  if p_changes ? 'terrain' then v_terrain := p_changes->'terrain'; end if;
  if p_changes ? 'name' and v_name is null then raise exception 'Planet name cannot be empty'; end if;

  update public.planets set
    name = coalesce(v_name, name),
    description = case when p_changes ? 'description' then coalesce(v_description, '') else description end,
    image_path = case when p_changes ? 'image_path' then v_image_path else image_path end,
    atmosphere = coalesce(v_atmosphere, atmosphere),
    temperature = coalesce(v_temperature, temperature),
    gravity = case when p_changes ? 'gravity' then v_gravity else gravity end,
    water_availability = case when p_changes ? 'water_availability' then v_water else water_availability end,
    terrain = coalesce(v_terrain, terrain)
    where id = p_planet_id;

  update public.student_planets set
    name = coalesce(v_name, name),
    description = case when p_changes ? 'description' then coalesce(v_description, '') else description end,
    image_path = case when p_changes ? 'image_path' then v_image_path else image_path end,
    atmosphere = coalesce(v_atmosphere, atmosphere),
    temperature = coalesce(v_temperature, temperature),
    gravity = case when p_changes ? 'gravity' then v_gravity else gravity end,
    water_availability = case when p_changes ? 'water_availability' then v_water else water_availability end,
    terrain = coalesce(v_terrain, terrain)
    where source_planet_id = p_planet_id and classroom_id = v_classroom;
  get diagnostics v_copies = row_count;
  return v_copies;
end;
$$;
grant execute on function public.teacher_update_source_planet(uuid, jsonb) to authenticated;

create or replace function public.teacher_update_student_name(p_student_id uuid, p_display_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if nullif(trim(p_display_name), '') is null then raise exception 'Student name cannot be empty'; end if;
  if not exists(
    select 1 from public.classroom_members cm join public.classrooms c on c.id = cm.classroom_id
    where cm.student_id = p_student_id and c.teacher_id = auth.uid() and public.is_classroom_teacher(c.id)
  ) then raise exception 'Student was not found in your classroom'; end if;
  update public.profiles set display_name = trim(p_display_name) where id = p_student_id and role = 'student';
  if not found then raise exception 'Student profile was not found'; end if;
end;
$$;
grant execute on function public.teacher_update_student_name(uuid, text) to authenticated;

create or replace function public.copy_species_to_student(p_species_id uuid, p_target_student_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_source public.species%rowtype; v_classroom uuid; v_target_planet uuid; v_new_id uuid;
begin
  select s.* into v_source from public.species s
    join public.student_planets source_planet on source_planet.id = s.planet_id
    where s.id = p_species_id and public.is_classroom_teacher(source_planet.classroom_id);
  if not found then raise exception 'Source species was not found in your classroom'; end if;
  select source_planet.classroom_id into v_classroom from public.student_planets source_planet where source_planet.id = v_source.planet_id;
  select target_planet.id into v_target_planet from public.student_planets target_planet
    where target_planet.student_id = p_target_student_id and target_planet.classroom_id = v_classroom;
  if v_target_planet is null then raise exception 'Target student does not have a planet in this classroom'; end if;

  insert into public.species (
    planet_id, student_id, parent_species_id, copied_from_species_id, name, image_path, description,
    characteristics, body_structure, locomotion, diet, habitat, reproduction, lifespan, population,
    predators, defensive_adaptations, environmental_tolerances, evolutionary_changes, student_notes, generation, is_extinct
  ) values (
    v_target_planet, p_target_student_id, null, v_source.id, v_source.name, v_source.image_path, v_source.description,
    v_source.characteristics, v_source.body_structure, v_source.locomotion, v_source.diet, v_source.habitat,
    v_source.reproduction, v_source.lifespan, v_source.population, v_source.predators,
    v_source.defensive_adaptations, v_source.environmental_tolerances,
    'Copied by the teacher from another student world.', '', 0, false
  ) returning id into v_new_id;
  insert into public.activity_logs(classroom_id, student_id, actor_id, action, details)
    values(v_classroom, p_target_student_id, auth.uid(), 'species_copied_to_student',
      pg_catalog.jsonb_build_object('species_id', v_new_id, 'copied_from_species_id', v_source.id));
  return v_new_id;
end;
$$;
grant execute on function public.copy_species_to_student(uuid, uuid) to authenticated;
