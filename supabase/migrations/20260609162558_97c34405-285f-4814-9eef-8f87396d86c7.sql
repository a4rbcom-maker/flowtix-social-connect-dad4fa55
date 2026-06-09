DROP POLICY IF EXISTS "Users broadcast to own topics" ON realtime.messages;
CREATE POLICY "Users broadcast to own topics" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND realtime.topic() LIKE (auth.uid()::text || '%'));