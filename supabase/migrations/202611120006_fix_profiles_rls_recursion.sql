-- Break the profiles -> classroom_members -> classroom role -> profiles RLS loop.
-- These narrowly-scoped SECURITY DEFINER helpers execute as the migration owner,
-- so their internal reads do not recursively invoke the caller's row policies.
create or replace function public.current_user_is_teacher() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'teacher'
  )
$$;

create or replace function public.can_view_profile(target_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select target_profile = (select auth.uid()) or exists(
    select 1
    from public.classroom_members cm
    join public.classrooms c on c.id = cm.classroom_id
    where cm.student_id = target_profile
      and c.teacher_id = (select auth.uid())
      and public.current_user_is_teacher()
  )
$$;

grant execute on function public.current_user_is_teacher() to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;

create or replace function public.is_classroom_teacher(classroom uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_user_is_teacher() and exists(
    select 1 from public.classrooms c
    where c.id = classroom and c.teacher_id = (select auth.uid())
  )
$$;

create or replace function public.is_classroom_student(classroom uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.classroom_members cm
    where cm.classroom_id = classroom and cm.student_id = (select auth.uid())
  )
$$;

drop policy if exists "profiles select self or classroom teacher" on public.profiles;
drop policy if exists "profiles select self or teacher" on public.profiles;
create policy "profiles select self or classroom teacher" on public.profiles for select to authenticated
using (public.can_view_profile(id));

drop policy if exists "classroom teacher manages classroom" on public.classrooms;
create policy "classroom teacher manages classroom" on public.classrooms for all to authenticated
using (teacher_id = (select auth.uid()) and public.current_user_is_teacher())
with check (teacher_id = (select auth.uid()) and public.current_user_is_teacher());
