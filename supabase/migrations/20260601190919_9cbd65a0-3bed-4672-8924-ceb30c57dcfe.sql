-- Restrict Realtime channel subscriptions: only allow topics that contain the user's own uid.
-- postgres_changes on user-scoped tables remains protected by each table's RLS;
-- this policy locks down Broadcast/Presence topic access on realtime.messages.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users subscribe to own topics" ON realtime.messages;
CREATE POLICY "Users subscribe to own topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND realtime.topic() LIKE '%' || auth.uid()::text || '%'
);

DROP POLICY IF EXISTS "Users broadcast to own topics" ON realtime.messages;
CREATE POLICY "Users broadcast to own topics"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND realtime.topic() LIKE '%' || auth.uid()::text || '%'
);