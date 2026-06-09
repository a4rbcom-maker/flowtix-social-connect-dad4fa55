CREATE POLICY "wa-media owner read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'wa-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "wa-media owner upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'wa-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "wa-media owner update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'wa-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'wa-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "wa-media owner delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'wa-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
);