-- Clean conversations where contact_name got polluted with the business's own WhatsApp display name.
-- LID-alias rows stored as @s.whatsapp.net with a 14+ digit local part are never real phones —
-- their contact_name should never have been set from an outbound echo.
UPDATE public.wa_conversations
SET contact_name = NULL,
    contact_phone = NULL
WHERE remote_jid ~ '^[0-9]{14,}@s\.whatsapp\.net$'
  AND (last_direction = 'out' OR last_direction IS NULL);

-- Also clear any residual "Xtra Menu"-style rows regardless of jid shape.
UPDATE public.wa_conversations
SET contact_name = NULL
WHERE contact_name = 'Xtra Menu';