-- 소상공인 보험 헤아림 — Supabase 스키마
-- Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 Run 하세요. (여러 번 실행해도 안전해요)

-- 1) 상담사 정보
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  branch text not null default '',
  role text not null default 'counselor' check (role in ('counselor', 'manager')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2) 상담 (고객·사업장·분석 결과·추천/가입 단계를 한 건의 JSON으로 저장)
create table if not exists public.consults (
  id text primary key,
  counselor_id uuid not null references public.profiles(id),
  consulted_at timestamptz not null default now(),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists consults_counselor_idx on public.consults (counselor_id, consulted_at desc);

-- 3) 변경 이력 (누가 언제 상담을 바꿨는지)
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid,
  action text not null,
  consult_id text,
  at timestamptz not null default now()
);

-- 관리자 여부 (RLS에서 사용)
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'manager' and active);
$$;

-- 회원 생성 시 profiles 자동 생성 (Authentication → Add user 에서 만든 계정)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, branch)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), coalesce(new.raw_user_meta_data->>'branch', ''))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 상담 저장 시 updated_at·감사로그 기록
create or replace function public.touch_consult() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  insert into public.audit_logs (user_id, action, consult_id) values (auth.uid(), tg_op, new.id);
  return new;
end; $$;
drop trigger if exists consults_touch on public.consults;
create trigger consults_touch before insert or update on public.consults
  for each row execute function public.touch_consult();

-- 행 단위 보안 (RLS)
alter table public.profiles enable row level security;
alter table public.consults enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles_manager_write" on public.profiles;
create policy "profiles_manager_write" on public.profiles for update to authenticated using (public.is_manager());

drop policy if exists "consults_select" on public.consults;
create policy "consults_select" on public.consults for select to authenticated
  using (counselor_id = auth.uid() or public.is_manager());
drop policy if exists "consults_insert" on public.consults;
create policy "consults_insert" on public.consults for insert to authenticated
  with check (counselor_id = auth.uid());
drop policy if exists "consults_update" on public.consults;
create policy "consults_update" on public.consults for update to authenticated
  using (counselor_id = auth.uid() or public.is_manager())
  with check (counselor_id = auth.uid() or public.is_manager());

drop policy if exists "audit_manager_read" on public.audit_logs;
create policy "audit_manager_read" on public.audit_logs for select to authenticated using (public.is_manager());

-- 실시간 반영 (다른 상담사의 변경이 화면에 바로 보이도록)
do $$ begin
  alter publication supabase_realtime add table public.consults;
exception when duplicate_object then null; end $$;
