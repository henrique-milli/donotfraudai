-- Attest on Supabase: private schemas, pgvector face gallery, private image bucket.
-- Tables of the attest edge function: next migration. Neither schema is exposed through the Data API.

create extension if not exists vector with schema extensions;

create schema if not exists attest;
create schema if not exists face;

-- neither schema is reachable through the auto-generated API roles
revoke all on schema attest from anon, authenticated;
revoke all on schema face from anon, authenticated;
alter default privileges in schema attest revoke all on tables from anon, authenticated;
alter default privileges in schema face revoke all on tables from anon, authenticated;

-- 1:N gallery of the face service (services/face/app/gallery.py): 128-d SFace embeddings, no images
create table if not exists face.templates (
    id          uuid primary key,
    subject     text not null,                 -- session id of the case
    kind        text not null,                 -- selfie / portrait / chipPhoto
    tags        jsonb not null default '{}',   -- e.g. {"document": "C1234567", "case": "10910"}
    embedding   extensions.vector(128) not null,
    liveness    real,
    created_at  timestamptz not null default now()
);
create index if not exists templates_subject on face.templates (subject);
create index if not exists templates_document on face.templates ((tags->>'document'));
create index if not exists templates_embedding on face.templates using hnsw (embedding extensions.vector_cosine_ops);
alter table face.templates enable row level security;   -- no policies: API roles see nothing

-- case images (supabase/functions/_shared/blobstore.ts), private, read only through the analyst console
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('case-images', 'case-images', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;
