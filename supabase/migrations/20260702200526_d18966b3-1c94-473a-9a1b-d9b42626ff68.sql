
-- Big unused indexes (~77 MB)
DROP INDEX IF EXISTS public.fb_people_db_fbid_idx;
DROP INDEX IF EXISTS public.fb_people_db_email_lower_idx;
DROP INDEX IF EXISTS public.wa_messages_user_remote_watime_desc_idx;
DROP INDEX IF EXISTS public.wa_messages_provider_message_id_idx;
DROP INDEX IF EXISTS public.wa_messages_user_provider_message_id_idx;
DROP INDEX IF EXISTS public.wa_messages_user_remote_created_from_phone_idx;

-- Small unused indexes on empty/inactive tables
DROP INDEX IF EXISTS public.idx_fb_bot_accounts_cookie_expires_at;
DROP INDEX IF EXISTS public.idx_fb_bot_accounts_user;
DROP INDEX IF EXISTS public.idx_ai_usage_logs_account;
DROP INDEX IF EXISTS public.idx_ai_usage_logs_user;
DROP INDEX IF EXISTS public.idx_announcements_active;
DROP INDEX IF EXISTS public.wa_conversations_user_contact_phone_named_idx;
DROP INDEX IF EXISTS public.wa_quick_replies_user_idx;
DROP INDEX IF EXISTS public.wa_quick_replies_user_category_idx;
DROP INDEX IF EXISTS public.customer_db_phone_idx;
DROP INDEX IF EXISTS public.customer_db_name_idx;
DROP INDEX IF EXISTS public.customer_db_fb_id_idx;
DROP INDEX IF EXISTS public.customer_db_email_idx;
DROP INDEX IF EXISTS public.idx_notif_reads_user;
DROP INDEX IF EXISTS public.idx_notif_reads_ann;
DROP INDEX IF EXISTS public.idx_send_log_user_unread;
DROP INDEX IF EXISTS public.idx_fb_jobs_user;
DROP INDEX IF EXISTS public.fb_jobs_user_status_idx;
DROP INDEX IF EXISTS public.fb_jobs_campaign_idx;
DROP INDEX IF EXISTS public.idx_admin_audit_target;
DROP INDEX IF EXISTS public.fb_autoreply_rules_user_idx;
DROP INDEX IF EXISTS public.fb_autoreply_rules_page_enabled_idx;
DROP INDEX IF EXISTS public.fb_pages_page_idx;
DROP INDEX IF EXISTS public.fb_pages_user_idx;
DROP INDEX IF EXISTS public.site_visits_is_bot_idx;
DROP INDEX IF EXISTS public.site_visits_session_idx;
DROP INDEX IF EXISTS public.fb_autoreply_log_page_idx;
DROP INDEX IF EXISTS public.fb_autoreply_log_rule_idx;
DROP INDEX IF EXISTS public.fb_autoreply_log_user_idx;
DROP INDEX IF EXISTS public.idx_scheduled_messages_user_status;
DROP INDEX IF EXISTS public.idx_scheduled_messages_scheduled_at;
