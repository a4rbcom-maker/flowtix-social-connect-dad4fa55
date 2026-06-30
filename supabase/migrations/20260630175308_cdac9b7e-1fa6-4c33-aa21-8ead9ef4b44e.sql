
CREATE POLICY "bulk_media_user_select" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'bulk-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "bulk_media_user_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'bulk-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "bulk_media_user_delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'bulk-media' AND auth.uid()::text = (storage.foldername(name))[1]);
