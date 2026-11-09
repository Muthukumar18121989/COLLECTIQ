-- COLLECTIQ initial schema
-- Money is stored as integer cents (bigint). PayPal identifiers are stored in
-- dedicated columns, separate from internal UUID primary keys. No PayPal
-- credentials are ever stored in the database.

create extension if not exists "pgcrypto";

-- updated_at trigger -----------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- profiles ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  business_name text,
  default_currency text not null default 'USD' check (default_currency in ('USD','EUR','GBP','CAD','AUD','INR')),
  autonomy_mode text not null default 'policy_driven' check (autonomy_mode in ('assisted','policy_driven','adaptive')),
  tax_rate_percent numeric(5,2) not null default 0 check (tax_rate_percent >= 0 and tax_rate_percent <= 50),
  timezone text not null default 'UTC',
  agent_paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- clients ----------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  email text not null,
  company text,
  phone text,
  currency text not null default 'USD' check (currency in ('USD','EUR','GBP','CAD','AUD','INR')),
  collection_paused boolean not null default false,
  dispute_open boolean not null default false,
  dispute_note text,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_user_idx on public.clients (user_id);
create unique index clients_user_email_idx on public.clients (user_id, lower(email));

-- projects ---------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active','completed','archived')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_client_idx on public.projects (user_id, client_id);

-- collection_policies ----------------------------------------------------------
create table public.collection_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active','paused')),
  is_default boolean not null default false,
  auto_execute boolean not null default true,
  steps jsonb not null default '[]'::jsonb,
  max_reminders_per_invoice int not null default 4 check (max_reminders_per_invoice between 1 and 10),
  min_days_between_reminders int not null default 2 check (min_days_between_reminders between 1 and 30),
  reminder_note_template text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index collection_policies_user_idx on public.collection_policies (user_id);
create unique index collection_policies_one_default on public.collection_policies (user_id) where is_default;

-- invoices ---------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete restrict,
  project_id uuid references public.projects (id) on delete set null,
  policy_id uuid references public.collection_policies (id) on delete set null,
  invoice_number text not null,
  currency text not null check (currency in ('USD','EUR','GBP','CAD','AUD','INR')),
  issue_date date not null,
  due_date date not null,
  status text not null default 'draft'
    check (status in ('draft','sent','unpaid','partially_paid','paid','overdue','cancelled','refunded')),
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  amount_paid_cents bigint not null default 0 check (amount_paid_cents >= 0),
  amount_due_cents bigint not null default 0 check (amount_due_cents >= 0),
  note text,
  collection_paused boolean not null default false,
  dispute_open boolean not null default false,
  paypal_mode text check (paypal_mode in ('sandbox','live','demo')),
  paypal_invoice_id text,
  paypal_status text,
  paypal_recipient_url text,
  paypal_invoicer_url text,
  paypal_last_synced_at timestamptz,
  sent_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  is_demo boolean not null default false,
  created_by text not null default 'user' check (created_by in ('user','agent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_due_after_issue check (due_date >= issue_date)
);
create unique index invoices_user_number_idx on public.invoices (user_id, invoice_number);
create unique index invoices_paypal_id_idx on public.invoices (paypal_invoice_id) where paypal_invoice_id is not null;
create index invoices_user_status_due_idx on public.invoices (user_id, status, due_date);
create index invoices_client_idx on public.invoices (client_id);

-- invoice_items ----------------------------------------------------------------
create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  description text not null,
  quantity numeric(10,2) not null check (quantity > 0),
  unit_amount_cents bigint not null check (unit_amount_cents >= 0),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id);

-- agent_tasks ------------------------------------------------------------------
create table public.agent_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  invoice_id uuid references public.invoices (id) on delete cascade,
  kind text not null check (kind in ('reminder','escalation','manual_review','send_invoice','sync')),
  step_id text,
  idempotency_key text not null unique,
  status text not null
    check (status in ('pending_approval','executing','succeeded','failed','blocked','suppressed','skipped')),
  trigger text not null check (trigger in ('scheduler','chat','user','webhook')),
  scheduled_for timestamptz,
  executed_at timestamptz,
  paypal_ref text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_tasks_user_invoice_idx on public.agent_tasks (user_id, invoice_id);

-- approvals --------------------------------------------------------------------
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('create_invoice','send_invoice','send_reminder','escalation','cancel_invoice','pause_collection','policy_recommendation')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','executed','failed','expired')),
  source text not null check (source in ('chat','scheduler','adaptive','user')),
  summary text not null,
  reasoning text,
  payload jsonb not null default '{}'::jsonb,
  invoice_id uuid references public.invoices (id) on delete cascade,
  client_id uuid references public.clients (id) on delete cascade,
  agent_task_id uuid references public.agent_tasks (id) on delete set null,
  idempotency_key text,
  result jsonb,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index approvals_user_status_idx on public.approvals (user_id, status);
create unique index approvals_pending_key_idx on public.approvals (idempotency_key) where status = 'pending' and idempotency_key is not null;

-- agent_activity (audit log) ---------------------------------------------------
create table public.agent_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null,
  invoice_id uuid references public.invoices (id) on delete set null,
  client_id uuid references public.clients (id) on delete set null,
  trigger text not null,
  observed_condition text,
  reasoning text,
  proposed_action text,
  permission_result text,
  approval_status text check (approval_status in ('not_required','pending','approved','rejected')),
  execution_status text not null check (execution_status in ('succeeded','pending','approval_required','failed','blocked','info')),
  paypal_ref text,
  error text,
  mode text not null default 'internal' check (mode in ('sandbox','live','demo','internal')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agent_activity_user_created_idx on public.agent_activity (user_id, created_at desc);
create index agent_activity_invoice_idx on public.agent_activity (invoice_id);

-- webhook_events ---------------------------------------------------------------
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  paypal_event_id text not null unique,
  event_type text not null,
  resource_id text,
  verification_status text not null check (verification_status in ('SUCCESS','FAILURE','SKIPPED_DEMO')),
  processing_status text not null check (processing_status in ('received','processed','ignored','failed','duplicate')),
  payload jsonb not null,
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index webhook_events_resource_idx on public.webhook_events (resource_id);

-- conversations ----------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_idx on public.conversations (user_id, updated_at desc);

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  tool_calls jsonb not null default '[]'::jsonb,
  approval_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversation_messages_conv_idx on public.conversation_messages (conversation_id, created_at);

-- updated_at triggers ----------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','clients','projects','collection_policies','invoices','invoice_items',
    'agent_tasks','approvals','agent_activity','webhook_events','conversations','conversation_messages']
  loop
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- Row Level Security -----------------------------------------------------------
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select using (id = auth.uid());
create policy "own profile insert" on public.profiles for insert with check (id = auth.uid());
create policy "own profile update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['clients','projects','collection_policies','invoices','invoice_items',
    'agent_tasks','approvals','agent_activity','conversations','conversation_messages']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows select" on public.%I for select using (user_id = auth.uid())', t);
    execute format('create policy "own rows insert" on public.%I for insert with check (user_id = auth.uid())', t);
    execute format('create policy "own rows update" on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy "own rows delete" on public.%I for delete using (user_id = auth.uid())', t);
  end loop;
end $$;

-- Audit log is append-only for users: no update/delete through the API.
drop policy "own rows update" on public.agent_activity;
drop policy "own rows delete" on public.agent_activity;

-- Webhook events are written only by the server (service role). Users may read their own.
alter table public.webhook_events enable row level security;
create policy "own webhook events select" on public.webhook_events for select using (user_id = auth.uid());
-- Users may only record clearly labelled simulated (demo) events for themselves.
create policy "own demo events insert" on public.webhook_events for insert
  with check (user_id = auth.uid() and verification_status = 'SKIPPED_DEMO');
