insert into public.verification_sessions (id, subject_ref, purpose, status)
values
  ('11111111-1111-1111-1111-111111111111', 'onboarding-ch-zh', 'onboarding', 'needs_review'),
  ('22222222-2222-2222-2222-222222222222', 'recovery-sim-swap', 'account_recovery', 'needs_review'),
  ('33333333-3333-3333-3333-333333333333', 'onboarding-pass', 'onboarding', 'auto_pass');

insert into public.risk_scores (session_id, score, decision, signals, model)
values
  ('11111111-1111-1111-1111-111111111111', 0.640, 'review', '{"liveness_score":0.41,"injection_likely":true}'::jsonb, 'risk-stub'),
  ('22222222-2222-2222-2222-222222222222', 0.580, 'review', '{"deepfake_score":0.62,"new_device":true}'::jsonb, 'risk-stub'),
  ('33333333-3333-3333-3333-333333333333', 0.110, 'allow', '{"liveness_score":0.91}'::jsonb, 'risk-stub');
