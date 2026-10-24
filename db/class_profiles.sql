-- Saved classes contain seat numbers only; all access uses the existing teacher token.
create table if not exists public.lesson_class_profiles (
  id uuid primary key default gen_random_uuid(),
  class_key text not null unique,
  label text not null,
  grade integer,
  class_no integer,
  max_seat integer not null default 30 check (max_seat between 1 and 120),
  roster jsonb not null,
  groups jsonb not null default '{}',
  rev bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.lesson_class_profiles add column if not exists max_seat integer not null default 30 check (max_seat between 1 and 120);
alter table public.lesson_class_profiles enable row level security;
revoke all on public.lesson_class_profiles from anon, authenticated;

create or replace function public.lesson_classes(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.lesson__teacher(p_token);
  return coalesce((select jsonb_agg(to_jsonb(c) order by updated_at desc) from public.lesson_class_profiles c), '[]');
end $$;

create or replace function public.lesson_class_save(p_token text, p_profile jsonb, p_rev bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cid uuid; c public.lesson_class_profiles; new_roster jsonb; gr jsonb; n int; bad boolean;
begin
  perform public.lesson__teacher(p_token);
  new_roster := p_profile->'roster'; gr := p_profile->'groups';
  if jsonb_typeof(new_roster) is distinct from 'array' or jsonb_typeof(gr) is distinct from 'object' then return jsonb_build_object('ok',false,'error','BAD_ROSTER'); end if;
  n := jsonb_array_length(new_roster);
  if n < 1 or n > 120 or length(trim(coalesce(p_profile->>'label',''))) not between 1 and 80 then return jsonb_build_object('ok',false,'error','BAD_ROSTER'); end if;
  select exists(select 1 from jsonb_array_elements_text(new_roster) v where v !~ '^[1-9][0-9]{0,2}$' or v::int>120) into bad;
  if bad or (select count(distinct v) from jsonb_array_elements_text(new_roster) v) <> n then return jsonb_build_object('ok',false,'error','BAD_ROSTER'); end if;
  if (select count(*) from jsonb_object_keys(gr)) <> n or exists(select 1 from jsonb_array_elements_text(new_roster) v where not gr ? v) or exists(select 1 from jsonb_each_text(gr) e where e.value !~ '^[1-9][0-9]{0,2}$' or e.value::int>120) then return jsonb_build_object('ok',false,'error','BAD_GROUPS'); end if;
  if coalesce((p_profile->>'max_seat')::int,120) < (select max(v::int) from jsonb_array_elements_text(new_roster) v) or coalesce((p_profile->>'max_seat')::int,1) not between 1 and 120 then return jsonb_build_object('ok',false,'error','BAD_ROSTER'); end if;
  if nullif(p_profile->>'id','') is null then
    insert into public.lesson_class_profiles(class_key,label,grade,class_no,max_seat,roster,groups)
      values ('cls-' || gen_random_uuid()::text,trim(p_profile->>'label'),nullif(p_profile->>'grade','')::int,nullif(p_profile->>'class_no','')::int,coalesce((p_profile->>'max_seat')::int,(select max(v::int) from jsonb_array_elements_text(new_roster) v)),new_roster,gr) returning * into c;
  else
    cid := (p_profile->>'id')::uuid;
    update public.lesson_class_profiles set label=trim(p_profile->>'label'),grade=nullif(p_profile->>'grade','')::int,class_no=nullif(p_profile->>'class_no','')::int,max_seat=coalesce((p_profile->>'max_seat')::int,(select max(v::int) from jsonb_array_elements_text(new_roster) v)),roster=new_roster,groups=gr,rev=rev+1,updated_at=now()
    where id=cid and rev=p_rev returning * into c;
    if not found then return jsonb_build_object('ok',false,'error','CONFLICT'); end if;
  end if;
  return jsonb_build_object('ok',true,'profile',to_jsonb(c));
end $$;
-- Resolve PL/pgSQL variable/column names explicitly.
revoke all on function public.lesson_classes(text) from public;
revoke all on function public.lesson_class_save(text,jsonb,bigint) from public;
grant execute on function public.lesson_classes(text) to anon, authenticated;
grant execute on function public.lesson_class_save(text,jsonb,bigint) to anon, authenticated;

-- Keep existing printed class QR codes valid when adopting saved classes.
insert into public.lesson_class_profiles(class_key,label,max_seat,roster,groups)
select class_key,class_label,(select max(k::int) from jsonb_object_keys(groups) k),
  coalesce(state->'roster',(select jsonb_agg(k::int order by k::int) from jsonb_object_keys(groups) k)),
  coalesce(state->'baseGroups',groups)
from (select distinct on (state->>'classKey') state->>'classKey' class_key,class_label,state,groups
      from public.lesson_sessions where nullif(state->>'classKey','') is not null
      and groups <> '{}'::jsonb order by state->>'classKey',created_at desc) s
on conflict (class_key) do nothing;

do $block$
declare def text;
begin
 select pg_get_functiondef('public.lesson_poll(text,text)'::regprocedure) into def;
 def := replace(def, '''seats'', s.seats));', '''seats'', s.seats, ''validSeats'', (select jsonb_agg(k::int order by k::int) from jsonb_object_keys(s.groups) k)));');
 execute def;
 select pg_get_functiondef('public.lesson_teacher_sessions(text)'::regprocedure) into def;
 def := replace(def, '''created_at'', created_at, ''active'', active)', '''created_at'', created_at, ''active'', active, ''classKey'', state->>''classKey'', ''profileId'', state->>''profileId'')');
 execute def;
end $block$;
