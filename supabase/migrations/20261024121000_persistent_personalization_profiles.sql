-- Per-model ISP branding and post-reset recovery plans.
-- This stores an explicit plan only; it does not flash firmware or configure a device.
CREATE TABLE public.personalization_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  profile_name TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  hardware_revision TEXT,
  firmware_version TEXT,
  branding_method TEXT NOT NULL DEFAULT 'pending_oem'
    CHECK (branding_method IN ('pending_oem', 'oem_firmware', 'vendor_preset', 'tr069_parameter', 'unsupported', 'unknown')),
  persistence_strategy TEXT NOT NULL DEFAULT 'pending_oem'
    CHECK (persistence_strategy IN ('pending_oem', 'persistent_oem_defaults', 'olt_reprovision', 'acs_bootstrap', 'local_recovery', 'unsupported', 'unknown')),
  recovery_strategy TEXT NOT NULL DEFAULT 'pending_oem'
    CHECK (recovery_strategy IN ('pending_oem', 'olt_omci', 'tr069_bootstrap', 'vendor_bootstrap', 'local_recovery', 'unknown')),
  package_reference TEXT,
  oem_compatibility_confirmed BOOLEAN NOT NULL DEFAULT false,
  company_name TEXT,
  logo_url TEXT,
  favicon_url TEXT,
  default_wifi_ssid_24 TEXT,
  default_wifi_ssid_5 TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'waiting_oem', 'package_ready', 'applied', 'verified', 'reset_tested', 'recovery_verified', 'manual_recovery_required')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, profile_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.personalization_profiles TO authenticated;
GRANT ALL ON public.personalization_profiles TO service_role;

ALTER TABLE public.personalization_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own personalization profiles"
  ON public.personalization_profiles
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_personalization_profiles_updated_at
  BEFORE UPDATE ON public.personalization_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX personalization_profiles_user_id_idx
  ON public.personalization_profiles(user_id);
CREATE INDEX personalization_profiles_model_idx
  ON public.personalization_profiles(manufacturer, model);
