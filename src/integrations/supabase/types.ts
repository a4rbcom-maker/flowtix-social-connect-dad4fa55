export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          admin_user_id: string
          created_at: string
          id: string
          ip_address: string | null
          payload: Json | null
          target_id: string | null
          target_type: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          admin_user_id: string
          created_at?: string
          id?: string
          ip_address?: string | null
          payload?: Json | null
          target_id?: string | null
          target_type?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          admin_user_id?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          payload?: Json | null
          target_id?: string | null
          target_type?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      bulk_job_recipients: {
        Row: {
          contact_id: string | null
          created_at: string
          error_message: string | null
          id: string
          job_id: string
          name: string
          phone: string
          sent_at: string | null
          status: Database["public"]["Enums"]["send_status"]
          user_id: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_id: string
          name: string
          phone: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["send_status"]
          user_id: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_id?: string
          name?: string
          phone?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["send_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_job_recipients_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "bulk_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_jobs: {
        Row: {
          channel: Database["public"]["Enums"]["send_channel"]
          completed_at: string | null
          created_at: string
          error_message: string | null
          failed_count: number
          id: string
          image_url: string | null
          interval_seconds: number
          message: string
          metadata: Json | null
          next_send_at: string | null
          scheduled_at: string
          sent_count: number
          started_at: string | null
          status: Database["public"]["Enums"]["bulk_job_status"]
          title: string
          total_recipients: number
          updated_at: string
          user_id: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["send_channel"]
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          failed_count?: number
          id?: string
          image_url?: string | null
          interval_seconds?: number
          message: string
          metadata?: Json | null
          next_send_at?: string | null
          scheduled_at?: string
          sent_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["bulk_job_status"]
          title: string
          total_recipients?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["send_channel"]
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          failed_count?: number
          id?: string
          image_url?: string | null
          interval_seconds?: number
          message?: string
          metadata?: Json | null
          next_send_at?: string | null
          scheduled_at?: string
          sent_count?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["bulk_job_status"]
          title?: string
          total_recipients?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          created_at: string
          id: string
          name: string
          notes: string | null
          phone: string
          tags: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          phone: string
          tags?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string
          tags?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      facebook_connections: {
        Row: {
          access_token: string
          created_at: string
          fb_user_email: string | null
          fb_user_id: string | null
          fb_user_name: string | null
          id: string
          last_synced_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          fb_user_email?: string | null
          fb_user_id?: string | null
          fb_user_name?: string | null
          id?: string
          last_synced_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          fb_user_email?: string | null
          fb_user_id?: string | null
          fb_user_name?: string | null
          id?: string
          last_synced_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fb_bot_accounts: {
        Row: {
          auth_method: Database["public"]["Enums"]["fb_auth_method"]
          cookie_expires_at: string | null
          created_at: string
          display_name: string
          encrypted_payload: string
          id: string
          last_check_at: string | null
          last_error: string | null
          status: Database["public"]["Enums"]["fb_account_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_method: Database["public"]["Enums"]["fb_auth_method"]
          cookie_expires_at?: string | null
          created_at?: string
          display_name: string
          encrypted_payload: string
          id?: string
          last_check_at?: string | null
          last_error?: string | null
          status?: Database["public"]["Enums"]["fb_account_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_method?: Database["public"]["Enums"]["fb_auth_method"]
          cookie_expires_at?: string | null
          created_at?: string
          display_name?: string
          encrypted_payload?: string
          id?: string
          last_check_at?: string | null
          last_error?: string | null
          status?: Database["public"]["Enums"]["fb_account_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      fb_campaigns: {
        Row: {
          account_id: string | null
          content_type: Database["public"]["Enums"]["fb_campaign_content_type"]
          created_at: string
          custom_text: string | null
          delay_max_seconds: number
          delay_min_seconds: number
          done_targets: number
          failed_count: number
          id: string
          last_job_id: string | null
          last_run_at: string | null
          media_ids: string[] | null
          name: string
          status: Database["public"]["Enums"]["fb_campaign_status"]
          success_count: number
          target_ids: string[]
          target_kind: Database["public"]["Enums"]["fb_campaign_target_kind"]
          target_names: Json | null
          template_id: string | null
          total_targets: number
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          content_type?: Database["public"]["Enums"]["fb_campaign_content_type"]
          created_at?: string
          custom_text?: string | null
          delay_max_seconds?: number
          delay_min_seconds?: number
          done_targets?: number
          failed_count?: number
          id?: string
          last_job_id?: string | null
          last_run_at?: string | null
          media_ids?: string[] | null
          name: string
          status?: Database["public"]["Enums"]["fb_campaign_status"]
          success_count?: number
          target_ids?: string[]
          target_kind?: Database["public"]["Enums"]["fb_campaign_target_kind"]
          target_names?: Json | null
          template_id?: string | null
          total_targets?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          content_type?: Database["public"]["Enums"]["fb_campaign_content_type"]
          created_at?: string
          custom_text?: string | null
          delay_max_seconds?: number
          delay_min_seconds?: number
          done_targets?: number
          failed_count?: number
          id?: string
          last_job_id?: string | null
          last_run_at?: string | null
          media_ids?: string[] | null
          name?: string
          status?: Database["public"]["Enums"]["fb_campaign_status"]
          success_count?: number
          target_ids?: string[]
          target_kind?: Database["public"]["Enums"]["fb_campaign_target_kind"]
          target_names?: Json | null
          template_id?: string | null
          total_targets?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fb_campaigns_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "fb_bot_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fb_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "fb_text_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_job_results: {
        Row: {
          created_at: string
          data: Json | null
          error: string | null
          id: string
          job_id: string
          status: Database["public"]["Enums"]["fb_result_status"]
          target: string | null
        }
        Insert: {
          created_at?: string
          data?: Json | null
          error?: string | null
          id?: string
          job_id: string
          status: Database["public"]["Enums"]["fb_result_status"]
          target?: string | null
        }
        Update: {
          created_at?: string
          data?: Json | null
          error?: string | null
          id?: string
          job_id?: string
          status?: Database["public"]["Enums"]["fb_result_status"]
          target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fb_job_results_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "fb_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_jobs: {
        Row: {
          account_id: string | null
          campaign_id: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          job_type: Database["public"]["Enums"]["fb_job_type"]
          payload: Json
          processed_items: number
          progress: number
          scheduled_at: string
          started_at: string | null
          status: Database["public"]["Enums"]["fb_job_status"]
          total_items: number
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          campaign_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_type: Database["public"]["Enums"]["fb_job_type"]
          payload?: Json
          processed_items?: number
          progress?: number
          scheduled_at?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["fb_job_status"]
          total_items?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          campaign_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          job_type?: Database["public"]["Enums"]["fb_job_type"]
          payload?: Json
          processed_items?: number
          progress?: number
          scheduled_at?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["fb_job_status"]
          total_items?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fb_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "fb_bot_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fb_jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "fb_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_media_assets: {
        Row: {
          created_at: string
          id: string
          kind: string
          mime_type: string | null
          name: string
          public_url: string
          size_bytes: number
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          mime_type?: string | null
          name: string
          public_url: string
          size_bytes?: number
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          mime_type?: string | null
          name?: string
          public_url?: string
          size_bytes?: number
          storage_path?: string
          user_id?: string
        }
        Relationships: []
      }
      fb_text_templates: {
        Row: {
          content: string
          created_at: string
          id: string
          name: string
          tags: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          name: string
          tags?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          name?: string
          tags?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_announcements: {
        Row: {
          body: string
          created_at: string
          created_by: string
          ends_at: string | null
          id: string
          level: string
          starts_at: string
          target_kind: string
          target_plan: string | null
          target_user_ids: string[] | null
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          ends_at?: string | null
          id?: string
          level?: string
          starts_at?: string
          target_kind?: string
          target_plan?: string | null
          target_user_ids?: string[] | null
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          ends_at?: string | null
          id?: string
          level?: string
          starts_at?: string
          target_kind?: string
          target_plan?: string | null
          target_user_ids?: string[] | null
          title?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          plan: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          plan?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          plan?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      scheduled_messages: {
        Row: {
          channel: Database["public"]["Enums"]["send_channel"]
          created_at: string
          error_message: string | null
          id: string
          image_url: string | null
          message: string
          metadata: Json | null
          recipients: Json
          scheduled_at: string
          status: Database["public"]["Enums"]["schedule_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["send_channel"]
          created_at?: string
          error_message?: string | null
          id?: string
          image_url?: string | null
          message: string
          metadata?: Json | null
          recipients?: Json
          scheduled_at: string
          status?: Database["public"]["Enums"]["schedule_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["send_channel"]
          created_at?: string
          error_message?: string | null
          id?: string
          image_url?: string | null
          message?: string
          metadata?: Json | null
          recipients?: Json
          scheduled_at?: string
          status?: Database["public"]["Enums"]["schedule_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      send_log: {
        Row: {
          action: string
          channel: Database["public"]["Enums"]["send_channel"]
          created_at: string
          description: string | null
          error_message: string | null
          id: string
          metadata: Json | null
          read: boolean
          recipient: string | null
          status: Database["public"]["Enums"]["send_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action: string
          channel: Database["public"]["Enums"]["send_channel"]
          created_at?: string
          description?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          read?: boolean
          recipient?: string | null
          status?: Database["public"]["Enums"]["send_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action?: string
          channel?: Database["public"]["Enums"]["send_channel"]
          created_at?: string
          description?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          read?: boolean
          recipient?: string | null
          status?: Database["public"]["Enums"]["send_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wa_ai_logs: {
        Row: {
          conversation_id: string | null
          created_at: string
          error_message: string | null
          id: string
          latency_ms: number | null
          model: string
          prompt_excerpt: string | null
          rating: number | null
          remote_jid: string
          response_text: string | null
          status: string
          tokens_in: number | null
          tokens_out: number | null
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          model: string
          prompt_excerpt?: string | null
          rating?: number | null
          remote_jid: string
          response_text?: string | null
          status?: string
          tokens_in?: number | null
          tokens_out?: number | null
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          model?: string
          prompt_excerpt?: string | null
          rating?: number | null
          remote_jid?: string
          response_text?: string | null
          status?: string
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_ai_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wa_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_conversations: {
        Row: {
          ai_enabled: boolean
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_archived: boolean
          last_direction: string
          last_message_at: string
          last_message_text: string | null
          remote_jid: string
          session_id: string
          unread_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_enabled?: boolean
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_archived?: boolean
          last_direction?: string
          last_message_at?: string
          last_message_text?: string | null
          remote_jid: string
          session_id: string
          unread_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_enabled?: boolean
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_archived?: boolean
          last_direction?: string
          last_message_at?: string
          last_message_text?: string | null
          remote_jid?: string
          session_id?: string
          unread_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wa_messages: {
        Row: {
          created_at: string
          direction: string
          from_phone: string | null
          id: string
          media_url: string | null
          msg_type: string
          raw: Json | null
          remote_jid: string
          session_id: string
          text_body: string | null
          to_phone: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          direction: string
          from_phone?: string | null
          id?: string
          media_url?: string | null
          msg_type?: string
          raw?: Json | null
          remote_jid: string
          session_id: string
          text_body?: string | null
          to_phone?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          direction?: string
          from_phone?: string | null
          id?: string
          media_url?: string | null
          msg_type?: string
          raw?: Json | null
          remote_jid?: string
          session_id?: string
          text_body?: string | null
          to_phone?: string | null
          user_id?: string
        }
        Relationships: []
      }
      wa_sessions: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string | null
          phone_number: string | null
          qr_data_url: string | null
          session_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string | null
          phone_number?: string | null
          qr_data_url?: string | null
          session_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string | null
          phone_number?: string | null
          qr_data_url?: string | null
          session_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_settings: {
        Row: {
          ai_blacklist: string[]
          ai_business_hours_only: boolean | null
          ai_enabled: boolean
          ai_knowledge_base: string | null
          ai_max_context_messages: number
          ai_model: string | null
          ai_reply_delay_seconds: number
          ai_system_prompt: string | null
          ai_welcome_message: string | null
          ai_working_hours_end: string | null
          ai_working_hours_start: string | null
          connection_type: string
          created_at: string
          id: string
          is_connected: boolean
          last_connected_at: string | null
          meta_access_token: string | null
          meta_business_account_id: string | null
          meta_phone_number_id: string | null
          meta_verify_token: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_blacklist?: string[]
          ai_business_hours_only?: boolean | null
          ai_enabled?: boolean
          ai_knowledge_base?: string | null
          ai_max_context_messages?: number
          ai_model?: string | null
          ai_reply_delay_seconds?: number
          ai_system_prompt?: string | null
          ai_welcome_message?: string | null
          ai_working_hours_end?: string | null
          ai_working_hours_start?: string | null
          connection_type?: string
          created_at?: string
          id?: string
          is_connected?: boolean
          last_connected_at?: string | null
          meta_access_token?: string | null
          meta_business_account_id?: string | null
          meta_phone_number_id?: string | null
          meta_verify_token?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_blacklist?: string[]
          ai_business_hours_only?: boolean | null
          ai_enabled?: boolean
          ai_knowledge_base?: string | null
          ai_max_context_messages?: number
          ai_model?: string | null
          ai_reply_delay_seconds?: number
          ai_system_prompt?: string | null
          ai_welcome_message?: string | null
          ai_working_hours_end?: string | null
          ai_working_hours_start?: string | null
          connection_type?: string
          created_at?: string
          id?: string
          is_connected?: boolean
          last_connected_at?: string | null
          meta_access_token?: string | null
          meta_business_account_id?: string | null
          meta_phone_number_id?: string | null
          meta_verify_token?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_daily_timeseries: {
        Args: { _days?: number }
        Returns: {
          day: string
          new_users: number
          send_failed: number
          send_success: number
          wa_messages: number
        }[]
      }
      admin_kpi_snapshot: { Args: never; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      bulk_job_status:
        | "scheduled"
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
        | "paused"
      fb_account_status:
        | "active"
        | "invalid"
        | "checkpoint"
        | "disabled"
        | "untested"
      fb_auth_method: "cookies" | "credentials"
      fb_campaign_content_type: "text" | "media"
      fb_campaign_status:
        | "draft"
        | "queued"
        | "running"
        | "paused"
        | "completed"
        | "failed"
      fb_campaign_target_kind: "groups" | "pages"
      fb_job_status:
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
        | "paused"
      fb_job_type:
        | "post_to_groups"
        | "extract_pages"
        | "extract_commenters"
        | "test_account"
      fb_result_status: "success" | "failed" | "skipped" | "pending"
      schedule_status: "scheduled" | "sending" | "sent" | "failed" | "cancelled"
      send_channel: "whatsapp" | "facebook" | "bulk" | "system"
      send_status: "pending" | "processing" | "success" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      bulk_job_status: [
        "scheduled",
        "running",
        "completed",
        "failed",
        "cancelled",
        "paused",
      ],
      fb_account_status: [
        "active",
        "invalid",
        "checkpoint",
        "disabled",
        "untested",
      ],
      fb_auth_method: ["cookies", "credentials"],
      fb_campaign_content_type: ["text", "media"],
      fb_campaign_status: [
        "draft",
        "queued",
        "running",
        "paused",
        "completed",
        "failed",
      ],
      fb_campaign_target_kind: ["groups", "pages"],
      fb_job_status: [
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
        "paused",
      ],
      fb_job_type: [
        "post_to_groups",
        "extract_pages",
        "extract_commenters",
        "test_account",
      ],
      fb_result_status: ["success", "failed", "skipped", "pending"],
      schedule_status: ["scheduled", "sending", "sent", "failed", "cancelled"],
      send_channel: ["whatsapp", "facebook", "bulk", "system"],
      send_status: ["pending", "processing", "success", "failed"],
    },
  },
} as const
