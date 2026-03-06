-- AJAWAI Module 3 Supabase schema
-- Includes required fields plus updated_at for last-write-wins sync.

create extension if not exists "pgcrypto";

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  full_name text not null default '',
  company text not null default '',
  role text not null default 'President',
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  description text not null default '',
  status text not null default 'planning',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid null references projects(id) on delete set null,
  title text not null,
  description text not null default '',
  status text not null default 'todo',
  priority text not null default 'medium',
  requires_approval boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text not null default '',
  email text not null,
  phone text not null default '',
  notes text not null default '',
  project_id uuid null references projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  content text not null,
  project_id uuid null references projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  approved_at timestamptz null,
  updated_at timestamptz not null default now()
);

create table if not exists timeline (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  description text not null,
  project_id uuid null references projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  key text not null,
  value text not null,
  category text not null default 'general',
  source text not null default 'secretary_phi',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'New Chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null,
  type text not null,
  content text not null,
  payload jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists settings (
  id text primary key,
  user_id uuid not null,
  key text not null,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated_at on profiles;
create trigger trg_profiles_updated_at
before update on profiles
for each row execute function set_updated_at();

drop trigger if exists trg_projects_updated_at on projects;
create trigger trg_projects_updated_at
before update on projects
for each row execute function set_updated_at();

drop trigger if exists trg_tasks_updated_at on tasks;
create trigger trg_tasks_updated_at
before update on tasks
for each row execute function set_updated_at();

drop trigger if exists trg_contacts_updated_at on contacts;
create trigger trg_contacts_updated_at
before update on contacts
for each row execute function set_updated_at();

drop trigger if exists trg_notes_updated_at on notes;
create trigger trg_notes_updated_at
before update on notes
for each row execute function set_updated_at();

drop trigger if exists trg_approvals_updated_at on approvals;
create trigger trg_approvals_updated_at
before update on approvals
for each row execute function set_updated_at();

drop trigger if exists trg_timeline_updated_at on timeline;
create trigger trg_timeline_updated_at
before update on timeline
for each row execute function set_updated_at();

drop trigger if exists trg_memory_updated_at on memory;
create trigger trg_memory_updated_at
before update on memory
for each row execute function set_updated_at();

drop trigger if exists trg_conversations_updated_at on conversations;
create trigger trg_conversations_updated_at
before update on conversations
for each row execute function set_updated_at();

drop trigger if exists trg_messages_updated_at on messages;
create trigger trg_messages_updated_at
before update on messages
for each row execute function set_updated_at();

drop trigger if exists trg_settings_updated_at on settings;
create trigger trg_settings_updated_at
before update on settings
for each row execute function set_updated_at();

alter table memory enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table settings enable row level security;

drop policy if exists memory_owner_policy on memory;
create policy memory_owner_policy on memory
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists conversations_owner_policy on conversations;
create policy conversations_owner_policy on conversations
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists messages_owner_policy on messages;
create policy messages_owner_policy on messages
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists settings_owner_policy on settings;
create policy settings_owner_policy on settings
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
