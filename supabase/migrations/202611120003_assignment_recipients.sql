create table public.assignment_recipients (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  species_id uuid references public.species(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (assignment_id, student_id)
);
create index assignment_recipients_student_idx on public.assignment_recipients(student_id, created_at desc);
alter table public.assignment_recipients enable row level security;
grant select, insert, update, delete on public.assignment_recipients to authenticated;

create policy "students read own assignment species" on public.assignment_recipients for select to authenticated
using (student_id = auth.uid() or exists(select 1 from public.assignments a where a.id = assignment_id and public.is_classroom_teacher(a.classroom_id)));
create policy "teachers manage assignment recipients" on public.assignment_recipients for all to authenticated
using (exists(select 1 from public.assignments a where a.id = assignment_id and public.is_classroom_teacher(a.classroom_id)))
with check (exists(select 1 from public.assignments a where a.id = assignment_id and public.is_classroom_teacher(a.classroom_id)));

create or replace function public.validate_assignment_recipient() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_classroom uuid; v_mode text; v_species_student uuid;
begin
  select a.classroom_id, a.mode into v_classroom, v_mode from public.assignments a where a.id = new.assignment_id;
  if v_classroom is null then raise exception 'Assignment was not found'; end if;
  if not exists(select 1 from public.classroom_members cm where cm.classroom_id = v_classroom and cm.student_id = new.student_id) then
    raise exception 'Assignment recipient must belong to its classroom';
  end if;
  if new.species_id is not null then
    select s.student_id into v_species_student from public.species s where s.id = new.species_id and not s.is_extinct;
    if v_species_student is distinct from new.student_id then raise exception 'Assigned species must be a living species in that student world'; end if;
  elsif v_mode in ('specific','random') then
    raise exception 'Specific and random assignments need a species for each student';
  end if;
  return new;
end;
$$;
create trigger validate_assignment_recipient_before_write before insert or update on public.assignment_recipients
for each row execute procedure public.validate_assignment_recipient();
