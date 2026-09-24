create type public.session_purpose as enum ('onboarding', 'account_recovery');
create type public.session_status as enum (
  'pending',
  'auto_pass',
  'auto_fail',
  'needs_review',
  'approved',
  'rejected'
);
create type public.evidence_kind as enum ('selfie', 'id_document', 'device_attestation');
create type public.review_decision as enum ('approve', 'reject', 'request_more');

create table public.verification_sessions (
  id uuid primary key default gen_random_uuid(),
  subject_ref text not null,
  purpose public.session_purpose not null default 'onboarding',
  status public.session_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.verification_sessions (id) on delete cascade,
  kind public.evidence_kind not null,
  storage_path text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.risk_scores (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.verification_sessions (id) on delete cascade,
  score numeric(6, 3) not null,
  decision text not null,
  signals jsonb not null default '{}'::jsonb,
  model text not null,
  created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.verification_sessions (id) on delete cascade,
  reviewer text not null,
  decision public.review_decision not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.verification_sessions enable row level security;
alter table public.evidence enable row level security;
alter table public.risk_scores enable row level security;
alter table public.reviews enable row level security;

-- Local hackathon defaults: tighten before any shared environment.
create policy "local_read_sessions" on public.verification_sessions for select using (true);
create policy "local_write_sessions" on public.verification_sessions for insert with check (true);
create policy "local_update_sessions" on public.verification_sessions for update using (true);

create policy "local_read_evidence" on public.evidence for select using (true);
create policy "local_write_evidence" on public.evidence for insert with check (true);

create policy "local_read_scores" on public.risk_scores for select using (true);
create policy "local_write_scores" on public.risk_scores for insert with check (true);

create policy "local_read_reviews" on public.reviews for select using (true);
create policy "local_write_reviews" on public.reviews for insert with check (true);
