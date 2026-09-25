-- Random face actions issued at selfie time (POST /v1/face-challenges). The phone signs the id into its
-- payload; intake consumes it once and checks the performed sequence against `steps`.
create table if not exists attest.face_challenges (
    id          text primary key,               -- 128-bit random, hex
    steps       jsonb not null,                 -- e.g. ["TILT_RIGHT", "TURN_LEFT", "MOVE_CLOSER"]
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null,
    used_at     timestamptz,
    client_ip   text
);
create index if not exists face_challenges_expires on attest.face_challenges (expires_at);
revoke all on attest.face_challenges from anon, authenticated;
