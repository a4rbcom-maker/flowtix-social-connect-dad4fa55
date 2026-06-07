CREATE POLICY "fb-media owner update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'fb-media' AND (auth.uid())::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'fb-media' AND (auth.uid())::text = (storage.foldername(name))[1]);