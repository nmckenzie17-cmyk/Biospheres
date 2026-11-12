create or replace function public.extinguish_species(p_species_id uuid, p_reason text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_planet uuid; v_classroom uuid; v_event uuid;
begin
  select s.planet_id, sp.classroom_id into v_planet, v_classroom
    from public.species s join public.student_planets sp on sp.id = s.planet_id
    where s.id = p_species_id and not s.is_extinct and public.is_classroom_teacher(sp.classroom_id);
  if v_planet is null then raise exception 'Living species not found in your classroom'; end if;
  update public.species set is_extinct = true where id = p_species_id;
  insert into public.extinction_events(classroom_id, teacher_id, species_id, planet_id, reason)
    values(v_classroom, auth.uid(), p_species_id, v_planet, p_reason) returning id into v_event;
  insert into public.species_events(planet_id, species_id, actor_id, event_type, event_data)
    values(v_planet, p_species_id, auth.uid(), 'extinction', pg_catalog.jsonb_build_object('reason', p_reason, 'event_id', v_event));
  return v_event;
end;
$$;
grant execute on function public.extinguish_species(uuid, text) to authenticated;

create or replace function public.restore_species(p_species_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_planet uuid; v_classroom uuid; v_event uuid;
begin
  select s.planet_id, sp.classroom_id into v_planet, v_classroom
    from public.species s join public.student_planets sp on sp.id = s.planet_id
    where s.id = p_species_id and s.is_extinct and public.is_classroom_teacher(sp.classroom_id);
  if v_planet is null then raise exception 'Extinct species not found in your classroom'; end if;
  update public.species set is_extinct = false where id = p_species_id;
  update public.extinction_events set restored_at = pg_catalog.now(), restored_by = auth.uid()
    where species_id = p_species_id and restored_at is null;
  insert into public.species_events(planet_id, species_id, actor_id, event_type, event_data)
    values(v_planet, p_species_id, auth.uid(), 'restoration', '{}'::jsonb);
  return p_species_id;
end;
$$;
grant execute on function public.restore_species(uuid) to authenticated;

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

-- Realtime feeds for student notifications and announcements.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements') then
    execute 'alter publication supabase_realtime add table public.announcements';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'environmental_events') then
    execute 'alter publication supabase_realtime add table public.environmental_events';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'species') then
    execute 'alter publication supabase_realtime add table public.species';
  end if;
end;
$$;
