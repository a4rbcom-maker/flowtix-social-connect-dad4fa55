-- Replace the broad SELECT policy with an owner-scoped one for API listing.
-- Public URLs still work via the storage CDN (which does not consult this policy).
DROP POLICY IF EXISTS "fb-media public read" ON storage.objects;

CREATE POLICY "fb-media owner list"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'fb-media'
    AND (auth.uid())::text = (storage.foldername(name))[1]
  );