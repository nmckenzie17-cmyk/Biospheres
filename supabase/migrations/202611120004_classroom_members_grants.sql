-- RLS policies decide which membership rows a user can see; SQL grants let
-- authenticated users reach the table in the first place.
grant select on table public.classroom_members to authenticated;
grant insert, update, delete on table public.classroom_members to authenticated;

-- Students can only select their own membership rows under the existing RLS
-- policy. Only the teacher policy can insert, update, or delete memberships.
