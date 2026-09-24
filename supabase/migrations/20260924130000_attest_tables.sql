-- Tables of the attest edge function (supabase/functions/attest). Schema `attest` is private: not exposed
-- through the Data API, reachable only by the api Edge Function with the database connection.

create sequence if not exists attest.case_number start 11001;

create table if not exists attest.challenges (
    id          bigserial primary key,
    value       text unique not null,           -- base64 of 32 random bytes
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null,
    used_at     timestamptz,
    client_ip   text
);

create table if not exists attest.face_clusters (
    id          bigserial primary key,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists attest.cases (
    id                  bigserial primary key,
    number              integer unique not null default nextval('attest.case_number'),
    session_id          text unique not null,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    demo_fixture        boolean not null default false,
    document_type       text not null default '',
    holder_name         text not null default '',
    document_number     text not null default '',
    nationality         text not null default '',
    birth_date          text not null default '',
    expiry_date         text not null default '',
    identity_source     text not null default '',
    device_model        text not null default '',
    device_key          text not null default '',
    client_ip           text,
    signature_ok        boolean,
    chain_ok            boolean,
    challenge_ok        boolean,
    secure_hardware     text not null default '',
    verified_boot       text not null default '',
    chip_expected       text not null default '',
    chip_read           boolean not null default false,
    chip_verified       boolean not null default false,
    device_score        integer,
    risk_score          integer not null default 0,
    risk_level          text not null,          -- LOW / MEDIUM / HIGH
    route               text not null,          -- CONTINUE / STEP_UP / MANUAL_REVIEW
    status              text not null,          -- AUTO_APPROVED / STEP_UP_REQUESTED / IN_TRIAGE / ESCALATED / APPROVED / REJECTED
    assurance           text not null default '',
    summary             text not null default '',
    recommendation      text not null default '',
    recommendation_text text not null default '',
    confidence          real not null default 0,
    why_not_approve     jsonb not null default '[]',
    why_not_reject      jsonb not null default '[]',
    resume_token_hash   text not null default '',
    face_cluster_id     bigint references attest.face_clusters(id) on delete set null,
    face_reference      text not null default '',
    face_similarity     real,
    liveness_score      real,
    payload             jsonb not null default '{}'
);
create index if not exists cases_document on attest.cases (document_number);
create index if not exists cases_device on attest.cases (device_key);
create index if not exists cases_status on attest.cases (status);

create table if not exists attest.signals (
    id           bigserial primary key,
    case_id      bigint not null references attest.cases(id) on delete cascade,
    grp          text not null,                 -- PAD, CLASSIFICATION, ..., FACE, SERVER
    side         text not null default '',
    label        text not null,
    outcome      text not null,                 -- PASS / FAIL / WARN / INFO / SKIPPED
    value        text not null default '',
    rule         text not null default '',
    risk_points  integer not null default 0,
    source       text not null default 'DEVICE' -- DEVICE / SERVER / RV<n>
);
create index if not exists signals_case on attest.signals (case_id);

create table if not exists attest.case_images (
    id           bigserial primary key,
    case_id      bigint not null references attest.cases(id) on delete cascade,
    kind         text not null,
    mime         text not null default 'image/jpeg',
    width        integer not null default 0,
    height       integer not null default 0,
    sha256       text not null,
    data         bytea,                          -- local mode
    storage_key  text not null default '',       -- Supabase Storage mode
    unique (case_id, kind)
);

create table if not exists attest.face_templates (
    id               bigserial primary key,
    case_id          bigint not null references attest.cases(id) on delete cascade,
    kind             text not null,              -- selfie / portrait / chipPhoto / rv<n>_selfie
    gallery_id       text not null,              -- id in the face service gallery (no embedding here)
    liveness         real,
    document_number  text not null default '',
    created_at       timestamptz not null default now(),
    unique (case_id, kind)
);
create index if not exists face_templates_gallery on attest.face_templates (gallery_id);

create table if not exists attest.reverifications (
    id            bigserial primary key,
    case_id       bigint not null references attest.cases(id) on delete cascade,
    number        integer not null,
    steps         jsonb not null default '[]',
    requested_by  text not null,
    status        text not null default 'PENDING', -- PENDING / PASSED / FAILED / EXPIRED
    created_at    timestamptz not null default now(),
    expires_at    timestamptz not null,
    completed_at  timestamptz,
    session_id    text not null default '',
    result        jsonb not null default '{}',
    unique (case_id, number)
);

create table if not exists attest.decisions (
    id                       bigserial primary key,
    case_id                  bigint not null references attest.cases(id) on delete cascade,
    analyst                  text not null,
    action                   text not null,     -- APPROVE / REQUEST_VERIFICATION / ESCALATE / REJECT
    note                     text not null default '',
    followed_recommendation  boolean not null default false,
    created_at               timestamptz not null default now()
);

-- append-only, hash-chained audit trail
create table if not exists attest.audit_events (
    id         bigserial primary key,
    case_id    bigint references attest.cases(id) on delete set null,
    case_number integer,                        -- hashed (case_id is not: it is nulled when a case is erased)
    at         timestamptz not null default now(),
    actor      text not null,
    kind       text not null,
    data       jsonb not null default '{}',
    prev_hash  text not null,
    hash       text unique not null
);

create or replace function attest.audit_append_only() returns trigger language plpgsql as $$
begin
    if tg_op = 'UPDATE' and old.case_id is not null and new.case_id is null
       and old.id = new.id and old.hash = new.hash and old.data = new.data then
        return new;  -- the case was deleted (on delete set null); the event itself is untouched
    end if;
    raise exception 'audit events are append-only';
end $$;
drop trigger if exists audit_append_only on attest.audit_events;
create trigger audit_append_only before update or delete on attest.audit_events
    for each row execute function attest.audit_append_only();

-- private by default: nothing for the API roles
revoke all on all tables in schema attest from anon, authenticated;
revoke all on all sequences in schema attest from anon, authenticated;
