-- Google commonly supplies full_name or name rather than display_name.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_display_name text;
begin
  v_display_name := coalesce(
    nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(pg_catalog.concat_ws(' ',
      nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'given_name'), ''),
      nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'family_name'), '')
    ), ''),
    nullif(pg_catalog.split_part(new.email, '@', 1), ''),
    ''
  );
  insert into public.profiles (id, display_name, role)
  values (new.id, v_display_name, 'student')
  on conflict (id) do update set display_name = excluded.display_name
    where nullif(pg_catalog.btrim(public.profiles.display_name), '') is null;
  return new;
end;
$$;

-- Fill profile names for Google users who signed up before the corrected trigger.
update public.profiles p
set display_name = coalesce(
  nullif(pg_catalog.btrim(u.raw_user_meta_data ->> 'display_name'), ''),
  nullif(pg_catalog.btrim(u.raw_user_meta_data ->> 'full_name'), ''),
  nullif(pg_catalog.btrim(u.raw_user_meta_data ->> 'name'), ''),
  nullif(pg_catalog.concat_ws(' ',
    nullif(pg_catalog.btrim(u.raw_user_meta_data ->> 'given_name'), ''),
    nullif(pg_catalog.btrim(u.raw_user_meta_data ->> 'family_name'), '')
  ), ''),
  nullif(pg_catalog.split_part(u.email, '@', 1), '')
)
from auth.users u
where u.id = p.id and nullif(pg_catalog.btrim(p.display_name), '') is null;
