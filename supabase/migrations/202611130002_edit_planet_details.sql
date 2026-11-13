create or replace function public.update_planet_detail(
  p_source_planet_id uuid, p_detail_index integer, p_title text, p_description text
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_classroom_id uuid; v_fact jsonb; v_details jsonb; v_copies integer;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if p_detail_index < 0 then raise exception 'Planet detail was not found'; end if;
  if nullif(trim(p_title), '') is null or nullif(trim(p_description), '') is null then
    raise exception 'A title and description are required';
  end if;
  select p.classroom_id, p.planet_details into v_classroom_id, v_details from public.planets p
    where p.id = p_source_planet_id and p.created_by = auth.uid() and public.is_classroom_teacher(p.classroom_id);
  if v_classroom_id is null then raise exception 'Source planet was not found in your classroom'; end if;
  if p_detail_index >= pg_catalog.jsonb_array_length(v_details) then raise exception 'Planet detail was not found'; end if;
  v_fact := pg_catalog.jsonb_build_object('title', trim(p_title), 'description', trim(p_description));
  update public.planets set planet_details = pg_catalog.jsonb_set(planet_details, array[p_detail_index::text], v_fact, false)
    where id = p_source_planet_id;
  update public.student_planets set planet_details = pg_catalog.jsonb_set(planet_details, array[p_detail_index::text], v_fact, false)
    where source_planet_id = p_source_planet_id and classroom_id = v_classroom_id
      and pg_catalog.jsonb_array_length(planet_details) > p_detail_index;
  get diagnostics v_copies = row_count;
  return v_copies;
end;
$$;
grant execute on function public.update_planet_detail(uuid, integer, text, text) to authenticated;
