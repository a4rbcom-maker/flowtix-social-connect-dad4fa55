CREATE UNIQUE INDEX IF NOT EXISTS fb_people_db_country_phone_norm_full_uidx
  ON public.fb_people_db (country, phone_norm);