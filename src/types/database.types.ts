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
      activity_logs: {
        Row: {
          action: Database["public"]["Enums"]["activity_action"]
          created_at: string
          description: string | null
          id: string
          ip: unknown
          metadata: Json
          resource_id: string | null
          resource_type: string | null
          user_agent: string | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["activity_action"]
          created_at?: string
          description?: string | null
          id?: string
          ip?: unknown
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["activity_action"]
          created_at?: string
          description?: string | null
          id?: string
          ip?: unknown
          metadata?: Json
          resource_id?: string | null
          resource_type?: string | null
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      ai_provider_accounts: {
        Row: {
          api_key_enc: string
          created_at: string
          credits: number
          id: string
          is_active: boolean
          last_checked_at: string | null
          name: string
          priority: number
          provider: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          api_key_enc: string
          created_at?: string
          credits?: number
          id?: string
          is_active?: boolean
          last_checked_at?: string | null
          name: string
          priority?: number
          provider?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          api_key_enc?: string
          created_at?: string
          credits?: number
          id?: string
          is_active?: boolean
          last_checked_at?: string | null
          name?: string
          priority?: number
          provider?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      exports: {
        Row: {
          created_at: string
          error: string | null
          expires_at: string | null
          file_size_bytes: number
          format: Database["public"]["Enums"]["export_format"]
          id: string
          name: string | null
          row_count: number
          source_id: string | null
          source_type: string
          status: Database["public"]["Enums"]["export_status"]
          storage_path: string | null
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          expires_at?: string | null
          file_size_bytes?: number
          format?: Database["public"]["Enums"]["export_format"]
          id?: string
          name?: string | null
          row_count?: number
          source_id?: string | null
          source_type?: string
          status?: Database["public"]["Enums"]["export_status"]
          storage_path?: string | null
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          expires_at?: string | null
          file_size_bytes?: number
          format?: Database["public"]["Enums"]["export_format"]
          id?: string
          name?: string | null
          row_count?: number
          source_id?: string | null
          source_type?: string
          status?: Database["public"]["Enums"]["export_status"]
          storage_path?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      extraction_jobs: {
        Row: {
          completed_at: string | null
          config: Json
          created_at: string
          error: string | null
          filters: Json
          id: string
          name: string
          result_count: number
          schedule_cron: string | null
          source: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          type: Database["public"]["Enums"]["extraction_type"]
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          completed_at?: string | null
          config?: Json
          created_at?: string
          error?: string | null
          filters?: Json
          id?: string
          name: string
          result_count?: number
          schedule_cron?: string | null
          source?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          type: Database["public"]["Enums"]["extraction_type"]
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          completed_at?: string | null
          config?: Json
          created_at?: string
          error?: string | null
          filters?: Json
          id?: string
          name?: string
          result_count?: number
          schedule_cron?: string | null
          source?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          type?: Database["public"]["Enums"]["extraction_type"]
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      extraction_results: {
        Row: {
          created_at: string
          data: Json
          fb_id: string | null
          fb_type: string | null
          id: string
          job_id: string
          metadata: Json
          platform: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          data?: Json
          fb_id?: string | null
          fb_type?: string | null
          id?: string
          job_id: string
          metadata?: Json
          platform?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          data?: Json
          fb_id?: string | null
          fb_type?: string | null
          id?: string
          job_id?: string
          metadata?: Json
          platform?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "extraction_results_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "extraction_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      facebook_accounts: {
        Row: {
          access_token_enc: string | null
          created_at: string
          fb_avatar_url: string | null
          fb_email: string | null
          fb_name: string | null
          fb_user_id: string
          id: string
          last_synced_at: string | null
          metadata: Json
          scopes: string[]
          status: Database["public"]["Enums"]["fb_account_status"]
          token_expires_at: string | null
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          access_token_enc?: string | null
          created_at?: string
          fb_avatar_url?: string | null
          fb_email?: string | null
          fb_name?: string | null
          fb_user_id: string
          id?: string
          last_synced_at?: string | null
          metadata?: Json
          scopes?: string[]
          status?: Database["public"]["Enums"]["fb_account_status"]
          token_expires_at?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          access_token_enc?: string | null
          created_at?: string
          fb_avatar_url?: string | null
          fb_email?: string | null
          fb_name?: string | null
          fb_user_id?: string
          id?: string
          last_synced_at?: string | null
          metadata?: Json
          scopes?: string[]
          status?: Database["public"]["Enums"]["fb_account_status"]
          token_expires_at?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      facebook_pages: {
        Row: {
          access_token_enc: string | null
          avatar_url: string | null
          category: string | null
          created_at: string
          facebook_account_id: string
          fan_count: number | null
          fb_page_id: string
          id: string
          is_verified: boolean
          last_synced_at: string | null
          metadata: Json
          name: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          access_token_enc?: string | null
          avatar_url?: string | null
          category?: string | null
          created_at?: string
          facebook_account_id: string
          fan_count?: number | null
          fb_page_id: string
          id?: string
          is_verified?: boolean
          last_synced_at?: string | null
          metadata?: Json
          name: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          access_token_enc?: string | null
          avatar_url?: string | null
          category?: string | null
          created_at?: string
          facebook_account_id?: string
          fan_count?: number | null
          fb_page_id?: string
          id?: string
          is_verified?: boolean
          last_synced_at?: string | null
          metadata?: Json
          name?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facebook_pages_facebook_account_id_fkey"
            columns: ["facebook_account_id"]
            isOneToOne: false
            referencedRelation: "facebook_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_browser_profiles: {
        Row: {
          cookies_enc: string | null
          created_at: string
          id: string
          is_incognito: boolean
          locale: string | null
          profile_data: Json
          profile_name: string
          profile_path: string | null
          session_id: string
          timezone: string | null
          updated_at: string
          user_agent: string | null
          user_id: string
          viewport_height: number | null
          viewport_width: number | null
          workspace_id: string | null
        }
        Insert: {
          cookies_enc?: string | null
          created_at?: string
          id?: string
          is_incognito?: boolean
          locale?: string | null
          profile_data?: Json
          profile_name: string
          profile_path?: string | null
          session_id: string
          timezone?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id: string
          viewport_height?: number | null
          viewport_width?: number | null
          workspace_id?: string | null
        }
        Update: {
          cookies_enc?: string | null
          created_at?: string
          id?: string
          is_incognito?: boolean
          locale?: string | null
          profile_data?: Json
          profile_name?: string
          profile_path?: string | null
          session_id?: string
          timezone?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string
          viewport_height?: number | null
          viewport_width?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fb_browser_profiles_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "fb_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_connection_attempts: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          ip_address: unknown
          metadata: Json
          result: Database["public"]["Enums"]["connection_attempt_result"]
          session_id: string
          user_agent: string | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json
          result?: Database["public"]["Enums"]["connection_attempt_result"]
          session_id: string
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json
          result?: Database["public"]["Enums"]["connection_attempt_result"]
          session_id?: string
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fb_connection_attempts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "fb_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_session_activity: {
        Row: {
          action: string
          created_at: string
          description: string | null
          id: string
          ip: unknown
          metadata: Json
          session_id: string
          user_agent: string | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          description?: string | null
          id?: string
          ip?: unknown
          metadata?: Json
          session_id: string
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          description?: string | null
          id?: string
          ip?: unknown
          metadata?: Json
          session_id?: string
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fb_session_activity_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "fb_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_session_events: {
        Row: {
          created_at: string
          description: string | null
          event_type: Database["public"]["Enums"]["fb_session_event_type"]
          id: string
          metadata: Json
          session_id: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_type: Database["public"]["Enums"]["fb_session_event_type"]
          id?: string
          metadata?: Json
          session_id: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          event_type?: Database["public"]["Enums"]["fb_session_event_type"]
          id?: string
          metadata?: Json
          session_id?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fb_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "fb_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_session_status_history: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          new_status: Database["public"]["Enums"]["fb_session_status"]
          old_status: Database["public"]["Enums"]["fb_session_status"] | null
          reason: string | null
          session_id: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          new_status: Database["public"]["Enums"]["fb_session_status"]
          old_status?: Database["public"]["Enums"]["fb_session_status"] | null
          reason?: string | null
          session_id: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          new_status?: Database["public"]["Enums"]["fb_session_status"]
          old_status?: Database["public"]["Enums"]["fb_session_status"] | null
          reason?: string | null
          session_id?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fb_session_status_history_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "fb_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_sessions: {
        Row: {
          browser: string | null
          connection_attempts: number
          connection_method: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          failure_counter: number
          fb_account_id: string | null
          fb_avatar_url: string | null
          fb_name: string | null
          fb_user_id: string | null
          id: string
          last_activity: string | null
          last_connected: string | null
          last_connection: string | null
          last_seen: string | null
          last_validation: string | null
          max_failure_retries: number
          metadata: Json
          name: string
          session_health: Database["public"]["Enums"]["session_health"] | null
          session_token_expires_at: string | null
          status: Database["public"]["Enums"]["fb_session_status"]
          updated_at: string
          user_id: string
          validation_interval_min: number
          workspace_id: string | null
        }
        Insert: {
          browser?: string | null
          connection_attempts?: number
          connection_method?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          failure_counter?: number
          fb_account_id?: string | null
          fb_avatar_url?: string | null
          fb_name?: string | null
          fb_user_id?: string | null
          id?: string
          last_activity?: string | null
          last_connected?: string | null
          last_connection?: string | null
          last_seen?: string | null
          last_validation?: string | null
          max_failure_retries?: number
          metadata?: Json
          name: string
          session_health?: Database["public"]["Enums"]["session_health"] | null
          session_token_expires_at?: string | null
          status?: Database["public"]["Enums"]["fb_session_status"]
          updated_at?: string
          user_id: string
          validation_interval_min?: number
          workspace_id?: string | null
        }
        Update: {
          browser?: string | null
          connection_attempts?: number
          connection_method?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          failure_counter?: number
          fb_account_id?: string | null
          fb_avatar_url?: string | null
          fb_name?: string | null
          fb_user_id?: string | null
          id?: string
          last_activity?: string | null
          last_connected?: string | null
          last_connection?: string | null
          last_seen?: string | null
          last_validation?: string | null
          max_failure_retries?: number
          metadata?: Json
          name?: string
          session_health?: Database["public"]["Enums"]["session_health"] | null
          session_token_expires_at?: string | null
          status?: Database["public"]["Enums"]["fb_session_status"]
          updated_at?: string
          user_id?: string
          validation_interval_min?: number
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fb_sessions_fb_account_id_fkey"
            columns: ["fb_account_id"]
            isOneToOne: false
            referencedRelation: "facebook_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          category: string
          created_at: string
          description: Json
          id: string
          is_enabled: boolean
          key: string
          metadata: Json
          name: Json
          plan_key: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          description?: Json
          id?: string
          is_enabled?: boolean
          key: string
          metadata?: Json
          name?: Json
          plan_key?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          description?: Json
          id?: string
          is_enabled?: boolean
          key?: string
          metadata?: Json
          name?: Json
          plan_key?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          due_at: string | null
          id: string
          metadata: Json
          number: string
          paid_at: string | null
          pdf_url: string | null
          plan_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subscription_id: string | null
          tax_cents: number
          total_cents: number
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          currency?: string
          due_at?: string | null
          id?: string
          metadata?: Json
          number: string
          paid_at?: string | null
          pdf_url?: string | null
          plan_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subscription_id?: string | null
          tax_cents?: number
          total_cents?: number
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          due_at?: string | null
          id?: string
          metadata?: Json
          number?: string
          paid_at?: string | null
          pdf_url?: string | null
          plan_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subscription_id?: string | null
          tax_cents?: number
          total_cents?: number
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          data: Json
          id: string
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          title: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      permissions: {
        Row: {
          action: string
          created_at: string
          description: string | null
          id: string
          key: string
          name: string
          resource: string
        }
        Insert: {
          action: string
          created_at?: string
          description?: string | null
          id?: string
          key: string
          name: string
          resource: string
        }
        Update: {
          action?: string
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          name?: string
          resource?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          features: Json | null
          id: string
          interval: Database["public"]["Enums"]["plan_interval"]
          is_active: boolean
          is_popular: boolean | null
          key: string
          limits: Json
          name: string
          price_cents: number
          sort_order: number
          trial_days: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json | null
          id?: string
          interval?: Database["public"]["Enums"]["plan_interval"]
          is_active?: boolean
          is_popular?: boolean | null
          key: string
          limits?: Json
          name: string
          price_cents?: number
          sort_order?: number
          trial_days?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json | null
          id?: string
          interval?: Database["public"]["Enums"]["plan_interval"]
          is_active?: boolean
          is_popular?: boolean | null
          key?: string
          limits?: Json
          name?: string
          price_cents?: number
          sort_order?: number
          trial_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          country: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          last_login_at: string | null
          locale: string
          phone: string | null
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          country?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          last_login_at?: string | null
          locale?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          country?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          last_login_at?: string | null
          locale?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      publish_jobs: {
        Row: {
          completed_at: string | null
          config: Json | null
          created_at: string | null
          id: string
          name: string | null
          progress: Json | null
          results: Json | null
          session_id: string
          started_at: string | null
          status: string
          updated_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          config?: Json | null
          created_at?: string | null
          id?: string
          name?: string | null
          progress?: Json | null
          results?: Json | null
          session_id: string
          started_at?: string | null
          status?: string
          updated_at?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          config?: Json | null
          created_at?: string | null
          id?: string
          name?: string | null
          progress?: Json | null
          results?: Json | null
          session_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          key: string
          name: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key: string
          name: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          key?: string
          name?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      session_lifecycle_logs: {
        Row: {
          action: string
          created_at: string
          from_status: Database["public"]["Enums"]["fb_session_status"] | null
          id: string
          metadata: Json
          reason: string | null
          session_id: string
          to_status: Database["public"]["Enums"]["fb_session_status"] | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["fb_session_status"] | null
          id?: string
          metadata?: Json
          reason?: string | null
          session_id: string
          to_status?: Database["public"]["Enums"]["fb_session_status"] | null
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["fb_session_status"] | null
          id?: string
          metadata?: Json
          reason?: string | null
          session_id?: string
          to_status?: Database["public"]["Enums"]["fb_session_status"] | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_lifecycle_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "fb_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          metadata: Json
          plan_id: string
          quantity: number
          status: Database["public"]["Enums"]["subscription_status"]
          trial_end: string | null
          trial_start: string | null
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json
          plan_id: string
          quantity?: number
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          metadata?: Json
          plan_id?: string
          quantity?: number
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_messages: {
        Row: {
          attachments: Json
          body: string
          created_at: string
          id: string
          is_staff: boolean
          ticket_id: string | null
          user_id: string | null
        }
        Insert: {
          attachments?: Json
          body: string
          created_at?: string
          id?: string
          is_staff?: boolean
          ticket_id?: string | null
          user_id?: string | null
        }
        Update: {
          attachments?: Json
          body?: string
          created_at?: string
          id?: string
          is_staff?: boolean
          ticket_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          category: string
          closed_at: string | null
          created_at: string
          description: string
          id: string
          metadata: Json
          priority: string
          resolved_at: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          category?: string
          closed_at?: string | null
          created_at?: string
          description: string
          id?: string
          metadata?: Json
          priority?: string
          resolved_at?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          category?: string
          closed_at?: string | null
          created_at?: string
          description?: string
          id?: string
          metadata?: Json
          priority?: string
          resolved_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          description: string | null
          is_public: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          is_public?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          description?: string | null
          is_public?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          assigned_by: string | null
          created_at: string
          id: string
          role_id: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          role_id: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          role_id?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_automation_logs: {
        Row: {
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          id: string
          message: string | null
          metadata: Json
          source: string
          source_id: string | null
          workspace_id: string
        }
        Insert: {
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json
          source: string
          source_id?: string | null
          workspace_id: string
        }
        Update: {
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json
          source?: string
          source_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_automation_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_automation_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wa_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_business_hours: {
        Row: {
          created_at: string
          id: string
          is_enabled: boolean
          outside_hours_action: string
          outside_hours_message: string | null
          schedule: Json
          timezone: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          outside_hours_action?: string
          outside_hours_message?: string | null
          schedule?: Json
          timezone?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          outside_hours_action?: string
          outside_hours_message?: string | null
          schedule?: Json
          timezone?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      wa_campaign_recipients: {
        Row: {
          attempts: number
          campaign_id: string
          contact_id: string
          created_at: string
          delivered_at: string | null
          error: string | null
          id: string
          jid: string | null
          phone: string
          read_at: string | null
          sent_at: string | null
          status: string
          wa_message_id: string | null
          workspace_id: string
        }
        Insert: {
          attempts?: number
          campaign_id: string
          contact_id: string
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          id?: string
          jid?: string | null
          phone: string
          read_at?: string | null
          sent_at?: string | null
          status?: string
          wa_message_id?: string | null
          workspace_id: string
        }
        Update: {
          attempts?: number
          campaign_id?: string
          contact_id?: string
          created_at?: string
          delivered_at?: string | null
          error?: string | null
          id?: string
          jid?: string | null
          phone?: string
          read_at?: string | null
          sent_at?: string | null
          status?: string
          wa_message_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "wa_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_campaigns: {
        Row: {
          audience_filter: Json
          completed_at: string | null
          config: Json
          content: Json
          created_at: string
          id: string
          last_error: string | null
          name: string
          scheduled_at: string | null
          started_at: string | null
          stats: Json
          status: Database["public"]["Enums"]["wa_campaign_status"]
          type: Database["public"]["Enums"]["wa_message_type"]
          updated_at: string
          user_id: string | null
          wa_session_id: string
          workspace_id: string | null
        }
        Insert: {
          audience_filter?: Json
          completed_at?: string | null
          config?: Json
          content?: Json
          created_at?: string
          id?: string
          last_error?: string | null
          name: string
          scheduled_at?: string | null
          started_at?: string | null
          stats?: Json
          status?: Database["public"]["Enums"]["wa_campaign_status"]
          type?: Database["public"]["Enums"]["wa_message_type"]
          updated_at?: string
          user_id?: string | null
          wa_session_id: string
          workspace_id?: string | null
        }
        Update: {
          audience_filter?: Json
          completed_at?: string | null
          config?: Json
          content?: Json
          created_at?: string
          id?: string
          last_error?: string | null
          name?: string
          scheduled_at?: string | null
          started_at?: string | null
          stats?: Json
          status?: Database["public"]["Enums"]["wa_campaign_status"]
          type?: Database["public"]["Enums"]["wa_message_type"]
          updated_at?: string
          user_id?: string | null
          wa_session_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_campaigns_wa_session_id_fkey"
            columns: ["wa_session_id"]
            isOneToOne: false
            referencedRelation: "wa_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_connection_attempts: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          ip_address: unknown
          metadata: Json
          result: Database["public"]["Enums"]["connection_attempt_result"]
          session_id: string
          user_agent: string | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json
          result: Database["public"]["Enums"]["connection_attempt_result"]
          session_id: string
          user_agent?: string | null
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json
          result?: Database["public"]["Enums"]["connection_attempt_result"]
          session_id?: string
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_connection_attempts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "wa_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_contact_blocks: {
        Row: {
          blocked_by: string | null
          contact_id: string
          created_at: string
          id: string
          reason: string | null
          workspace_id: string
        }
        Insert: {
          blocked_by?: string | null
          contact_id: string
          created_at?: string
          id?: string
          reason?: string | null
          workspace_id: string
        }
        Update: {
          blocked_by?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_contact_blocks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_contact_list_members: {
        Row: {
          added_at: string
          contact_id: string
          list_id: string
        }
        Insert: {
          added_at?: string
          contact_id: string
          list_id: string
        }
        Update: {
          added_at?: string
          contact_id?: string
          list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_contact_list_members_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_contact_list_members_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "wa_contact_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_contact_lists: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      wa_contacts: {
        Row: {
          assigned_to: string | null
          avatar_url: string | null
          company: string | null
          country: string | null
          created_at: string
          custom_fields: Json
          email: string | null
          id: string
          is_vip: boolean
          jid: string | null
          labels: string[]
          last_order_at: string | null
          last_seen: string | null
          message_count: number
          name: string | null
          notes: string | null
          phone: string
          push_name: string | null
          source: string | null
          status: Database["public"]["Enums"]["wa_contact_status"]
          tags: string[]
          total_messages: number
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          avatar_url?: string | null
          company?: string | null
          country?: string | null
          created_at?: string
          custom_fields?: Json
          email?: string | null
          id?: string
          is_vip?: boolean
          jid?: string | null
          labels?: string[]
          last_order_at?: string | null
          last_seen?: string | null
          message_count?: number
          name?: string | null
          notes?: string | null
          phone: string
          push_name?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["wa_contact_status"]
          tags?: string[]
          total_messages?: number
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          avatar_url?: string | null
          company?: string | null
          country?: string | null
          created_at?: string
          custom_fields?: Json
          email?: string | null
          id?: string
          is_vip?: boolean
          jid?: string | null
          labels?: string[]
          last_order_at?: string | null
          last_seen?: string | null
          message_count?: number
          name?: string | null
          notes?: string | null
          phone?: string
          push_name?: string | null
          source?: string | null
          status?: Database["public"]["Enums"]["wa_contact_status"]
          tags?: string[]
          total_messages?: number
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      wa_conversations: {
        Row: {
          ai_route_level: Database["public"]["Enums"]["ai_route_level"] | null
          assigned_to: string | null
          contact_id: string
          created_at: string
          id: string
          is_archived: boolean
          is_spam: boolean
          is_starred: boolean
          last_ai_reply_at: string | null
          last_message_at: string | null
          last_message_preview: string | null
          metadata: Json
          status: string
          unread_count: number
          updated_at: string
          wa_session_id: string
          workspace_id: string | null
        }
        Insert: {
          ai_route_level?: Database["public"]["Enums"]["ai_route_level"] | null
          assigned_to?: string | null
          contact_id: string
          created_at?: string
          id?: string
          is_archived?: boolean
          is_spam?: boolean
          is_starred?: boolean
          last_ai_reply_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          metadata?: Json
          status?: string
          unread_count?: number
          updated_at?: string
          wa_session_id: string
          workspace_id?: string | null
        }
        Update: {
          ai_route_level?: Database["public"]["Enums"]["ai_route_level"] | null
          assigned_to?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          is_archived?: boolean
          is_spam?: boolean
          is_starred?: boolean
          last_ai_reply_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          metadata?: Json
          status?: string
          unread_count?: number
          updated_at?: string
          wa_session_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_conversations_wa_session_id_fkey"
            columns: ["wa_session_id"]
            isOneToOne: false
            referencedRelation: "wa_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_keyword_rules: {
        Row: {
          action: string
          case_sensitive: boolean
          created_at: string
          id: string
          is_active: boolean
          keywords: string[]
          match_type: Database["public"]["Enums"]["wa_match_type"]
          name: string
          priority: number
          reply_template_id: string | null
          reply_text: string | null
          updated_at: string
          wa_session_id: string | null
          workflow_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action?: string
          case_sensitive?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          match_type?: Database["public"]["Enums"]["wa_match_type"]
          name: string
          priority?: number
          reply_template_id?: string | null
          reply_text?: string | null
          updated_at?: string
          wa_session_id?: string | null
          workflow_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          case_sensitive?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          match_type?: Database["public"]["Enums"]["wa_match_type"]
          name?: string
          priority?: number
          reply_template_id?: string | null
          reply_text?: string | null
          updated_at?: string
          wa_session_id?: string | null
          workflow_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_keyword_rules_reply_template_id_fkey"
            columns: ["reply_template_id"]
            isOneToOne: false
            referencedRelation: "wa_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_keyword_rules_wa_session_id_fkey"
            columns: ["wa_session_id"]
            isOneToOne: false
            referencedRelation: "wa_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_keyword_rules_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "wa_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_messages: {
        Row: {
          ai_model: string | null
          body: string | null
          buttons: Json | null
          contact_id: string | null
          conversation_id: string
          created_at: string
          direction: Database["public"]["Enums"]["wa_message_direction"]
          id: string
          media_height: number | null
          media_mime_type: string | null
          media_size_bytes: number | null
          media_storage_key: string | null
          media_width: number | null
          metadata: Json
          quoted_message_id: string | null
          sent_by_ai: boolean
          status: Database["public"]["Enums"]["wa_message_status"]
          type: Database["public"]["Enums"]["wa_message_type"]
          wa_message_id: string | null
          wa_session_id: string
          workspace_id: string | null
        }
        Insert: {
          ai_model?: string | null
          body?: string | null
          buttons?: Json | null
          contact_id?: string | null
          conversation_id: string
          created_at?: string
          direction: Database["public"]["Enums"]["wa_message_direction"]
          id?: string
          media_height?: number | null
          media_mime_type?: string | null
          media_size_bytes?: number | null
          media_storage_key?: string | null
          media_width?: number | null
          metadata?: Json
          quoted_message_id?: string | null
          sent_by_ai?: boolean
          status?: Database["public"]["Enums"]["wa_message_status"]
          type: Database["public"]["Enums"]["wa_message_type"]
          wa_message_id?: string | null
          wa_session_id: string
          workspace_id?: string | null
        }
        Update: {
          ai_model?: string | null
          body?: string | null
          buttons?: Json | null
          contact_id?: string | null
          conversation_id?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["wa_message_direction"]
          id?: string
          media_height?: number | null
          media_mime_type?: string | null
          media_size_bytes?: number | null
          media_storage_key?: string | null
          media_width?: number | null
          metadata?: Json
          quoted_message_id?: string | null
          sent_by_ai?: boolean
          status?: Database["public"]["Enums"]["wa_message_status"]
          type?: Database["public"]["Enums"]["wa_message_type"]
          wa_message_id?: string | null
          wa_session_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wa_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_quoted_message_id_fkey"
            columns: ["quoted_message_id"]
            isOneToOne: false
            referencedRelation: "wa_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_messages_wa_session_id_fkey"
            columns: ["wa_session_id"]
            isOneToOne: false
            referencedRelation: "wa_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_notes: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_notes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wa_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_provider_configs: {
        Row: {
          api_key_enc: string | null
          base_url: string | null
          business_id: string | null
          created_at: string
          id: string
          is_active: boolean
          metadata: Json
          models: Json
          name: string
          phone_number_id: string | null
          provider: Database["public"]["Enums"]["ai_provider"]
          provider_type: Database["public"]["Enums"]["wa_provider_type"]
          updated_at: string
          webhook_secret_enc: string | null
          workspace_id: string
        }
        Insert: {
          api_key_enc?: string | null
          base_url?: string | null
          business_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          models?: Json
          name: string
          phone_number_id?: string | null
          provider?: Database["public"]["Enums"]["ai_provider"]
          provider_type?: Database["public"]["Enums"]["wa_provider_type"]
          updated_at?: string
          webhook_secret_enc?: string | null
          workspace_id: string
        }
        Update: {
          api_key_enc?: string | null
          base_url?: string | null
          business_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          metadata?: Json
          models?: Json
          name?: string
          phone_number_id?: string | null
          provider?: Database["public"]["Enums"]["ai_provider"]
          provider_type?: Database["public"]["Enums"]["wa_provider_type"]
          updated_at?: string
          webhook_secret_enc?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      wa_quick_replies: {
        Row: {
          body: string
          category: string
          created_at: string
          created_by: string | null
          id: string
          shortcut: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          body: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          shortcut: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          shortcut?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      wa_session_activity: {
        Row: {
          action: string
          created_at: string
          description: string | null
          id: string
          ip: unknown
          metadata: Json
          session_id: string
          user_agent: string | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          created_at?: string
          description?: string | null
          id?: string
          ip?: unknown
          metadata?: Json
          session_id: string
          user_agent?: string | null
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          created_at?: string
          description?: string | null
          id?: string
          ip?: unknown
          metadata?: Json
          session_id?: string
          user_agent?: string | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_session_activity_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "wa_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_session_events: {
        Row: {
          created_at: string
          description: string | null
          event_type: string
          id: string
          metadata: Json
          session_id: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_type: string
          id?: string
          metadata?: Json
          session_id: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          session_id?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_session_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "wa_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_session_lifecycle_logs: {
        Row: {
          action: string
          created_at: string
          from_status: Database["public"]["Enums"]["wa_session_status"] | null
          id: string
          metadata: Json
          reason: string | null
          session_id: string
          to_status: Database["public"]["Enums"]["wa_session_status"] | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["wa_session_status"] | null
          id?: string
          metadata?: Json
          reason?: string | null
          session_id: string
          to_status?: Database["public"]["Enums"]["wa_session_status"] | null
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["wa_session_status"] | null
          id?: string
          metadata?: Json
          reason?: string | null
          session_id?: string
          to_status?: Database["public"]["Enums"]["wa_session_status"] | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_session_lifecycle_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "wa_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_session_status_history: {
        Row: {
          created_at: string
          id: string
          metadata: Json
          new_status: Database["public"]["Enums"]["wa_session_status"]
          old_status: Database["public"]["Enums"]["wa_session_status"] | null
          reason: string | null
          session_id: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          new_status: Database["public"]["Enums"]["wa_session_status"]
          old_status?: Database["public"]["Enums"]["wa_session_status"] | null
          reason?: string | null
          session_id: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          new_status?: Database["public"]["Enums"]["wa_session_status"]
          old_status?: Database["public"]["Enums"]["wa_session_status"] | null
          reason?: string | null
          session_id?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_session_status_history_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "wa_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_session_transitions: {
        Row: {
          from_status: Database["public"]["Enums"]["wa_session_status"]
          to_status: Database["public"]["Enums"]["wa_session_status"]
        }
        Insert: {
          from_status: Database["public"]["Enums"]["wa_session_status"]
          to_status: Database["public"]["Enums"]["wa_session_status"]
        }
        Update: {
          from_status?: Database["public"]["Enums"]["wa_session_status"]
          to_status?: Database["public"]["Enums"]["wa_session_status"]
        }
        Relationships: []
      }
      wa_sessions: {
        Row: {
          avatar_url: string | null
          business_id: string | null
          connection_attempts: number
          connection_method: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          failure_counter: number
          id: string
          last_activity: string | null
          last_connected: string | null
          last_connection: string | null
          last_qr_at: string | null
          last_seen: string | null
          last_validation: string | null
          max_failure_retries: number
          metadata: Json
          name: string
          phone_number: string | null
          phone_number_jid: string | null
          provider_config_id: string | null
          provider_type: Database["public"]["Enums"]["wa_provider_type"]
          push_name: string | null
          qr_code_enc: string | null
          session_health: Database["public"]["Enums"]["session_health"] | null
          session_token_expires_at: string | null
          status: Database["public"]["Enums"]["wa_session_status"]
          updated_at: string
          user_id: string
          validation_interval_min: number
          workspace_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          business_id?: string | null
          connection_attempts?: number
          connection_method?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          failure_counter?: number
          id?: string
          last_activity?: string | null
          last_connected?: string | null
          last_connection?: string | null
          last_qr_at?: string | null
          last_seen?: string | null
          last_validation?: string | null
          max_failure_retries?: number
          metadata?: Json
          name: string
          phone_number?: string | null
          phone_number_jid?: string | null
          provider_config_id?: string | null
          provider_type?: Database["public"]["Enums"]["wa_provider_type"]
          push_name?: string | null
          qr_code_enc?: string | null
          session_health?: Database["public"]["Enums"]["session_health"] | null
          session_token_expires_at?: string | null
          status?: Database["public"]["Enums"]["wa_session_status"]
          updated_at?: string
          user_id: string
          validation_interval_min?: number
          workspace_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          business_id?: string | null
          connection_attempts?: number
          connection_method?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          failure_counter?: number
          id?: string
          last_activity?: string | null
          last_connected?: string | null
          last_connection?: string | null
          last_qr_at?: string | null
          last_seen?: string | null
          last_validation?: string | null
          max_failure_retries?: number
          metadata?: Json
          name?: string
          phone_number?: string | null
          phone_number_jid?: string | null
          provider_config_id?: string | null
          provider_type?: Database["public"]["Enums"]["wa_provider_type"]
          push_name?: string | null
          qr_code_enc?: string | null
          session_health?: Database["public"]["Enums"]["session_health"] | null
          session_token_expires_at?: string | null
          status?: Database["public"]["Enums"]["wa_session_status"]
          updated_at?: string
          user_id?: string
          validation_interval_min?: number
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_sessions_provider_config_id_fkey"
            columns: ["provider_config_id"]
            isOneToOne: false
            referencedRelation: "wa_provider_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_smart_lists: {
        Row: {
          color: string | null
          created_at: string
          filters: Json
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          filters?: Json
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      wa_templates: {
        Row: {
          body: string
          buttons: Json
          category: string | null
          created_at: string
          footer: string | null
          header: string | null
          id: string
          is_approved: boolean
          language: string
          name: string
          type: Database["public"]["Enums"]["wa_message_type"]
          updated_at: string
          variables: string[]
          workspace_id: string | null
        }
        Insert: {
          body: string
          buttons?: Json
          category?: string | null
          created_at?: string
          footer?: string | null
          header?: string | null
          id?: string
          is_approved?: boolean
          language?: string
          name: string
          type?: Database["public"]["Enums"]["wa_message_type"]
          updated_at?: string
          variables?: string[]
          workspace_id?: string | null
        }
        Update: {
          body?: string
          buttons?: Json
          category?: string | null
          created_at?: string
          footer?: string | null
          header?: string | null
          id?: string
          is_approved?: boolean
          language?: string
          name?: string
          type?: Database["public"]["Enums"]["wa_message_type"]
          updated_at?: string
          variables?: string[]
          workspace_id?: string | null
        }
        Relationships: []
      }
      wa_workflow_states: {
        Row: {
          contact_id: string
          context: Json
          created_at: string
          current_step_id: string | null
          id: string
          status: string
          updated_at: string
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          contact_id: string
          context?: Json
          created_at?: string
          current_step_id?: string | null
          id?: string
          status?: string
          updated_at?: string
          workflow_id: string
          workspace_id: string
        }
        Update: {
          contact_id?: string
          context?: Json
          created_at?: string
          current_step_id?: string | null
          id?: string
          status?: string
          updated_at?: string
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_workflow_states_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_workflow_states_current_step_id_fkey"
            columns: ["current_step_id"]
            isOneToOne: false
            referencedRelation: "wa_workflow_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_workflow_states_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "wa_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_workflow_steps: {
        Row: {
          config: Json
          created_at: string
          id: string
          sort_order: number
          step_type: string
          workflow_id: string
          workspace_id: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          sort_order?: number
          step_type: string
          workflow_id: string
          workspace_id?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          sort_order?: number
          step_type?: string
          workflow_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_workflow_steps_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "wa_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_workflows: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          status: Database["public"]["Enums"]["wa_automation_status"]
          trigger: Json
          updated_at: string
          wa_session_id: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          status?: Database["public"]["Enums"]["wa_automation_status"]
          trigger?: Json
          updated_at?: string
          wa_session_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["wa_automation_status"]
          trigger?: Json
          updated_at?: string
          wa_session_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_workflows_wa_session_id_fkey"
            columns: ["wa_session_id"]
            isOneToOne: false
            referencedRelation: "wa_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _current_workspace_id: { Args: never; Returns: string }
      admin_ai_cost_trend: {
        Args: { p_days?: number }
        Returns: {
          cost: number
          date: string
          invocations: number
        }[]
      }
      admin_ai_model_usage: {
        Args: never
        Returns: {
          avg_cost_per_invocation: number
          invocations: number
          model: string
          provider: string
          success_rate: number
          total_cost: number
          total_tokens: number
        }[]
      }
      admin_ai_overview: {
        Args: never
        Returns: {
          active_workspaces: number
          avg_latency_ms: number
          cost_this_month: number
          cost_this_week: number
          cost_today: number
          escalated_to_human: number
          failed_invocations: number
          successful_invocations: number
          total_completion_tokens: number
          total_cost_usd: number
          total_invocations: number
          total_prompt_tokens: number
          total_tokens: number
          total_workspaces: number
        }[]
      }
      admin_audit_log_stats: {
        Args: never
        Returns: {
          today_count: number
          total_logs: number
          unique_users_today: number
          week_count: number
        }[]
      }
      admin_block_ip: {
        Args: { p_ip: string; p_reason?: string }
        Returns: undefined
      }
      admin_broadcast_notification: {
        Args: {
          p_body: string
          p_expires_at?: string
          p_title: string
          p_type?: string
        }
        Returns: number
      }
      admin_bulk_upsert_settings: {
        Args: { p_settings: Json }
        Returns: undefined
      }
      admin_change_user_role: {
        Args: { p_role?: string; p_user_id: string; p_workspace_id?: string }
        Returns: undefined
      }
      admin_count_ai_configs: {
        Args: { p_is_active?: boolean; p_search?: string }
        Returns: number
      }
      admin_count_ai_invocations: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_model?: string
          p_success?: boolean
          p_workspace_id?: string
        }
        Returns: number
      }
      admin_create_flag: {
        Args: {
          p_category?: string
          p_description?: Json
          p_is_enabled?: boolean
          p_key: string
          p_name: Json
          p_plan_key?: string
        }
        Returns: string
      }
      admin_create_plan: {
        Args: {
          p_currency?: string
          p_description?: string
          p_features?: Json
          p_interval?: string
          p_is_popular?: boolean
          p_key: string
          p_limits?: Json
          p_name: string
          p_price_cents: number
          p_sort_order?: number
          p_trial_days?: number
        }
        Returns: string
      }
      admin_create_subscription: {
        Args: { p_plan_id?: string; p_status?: string; p_workspace_id?: string }
        Returns: string
      }
      admin_delete_flag: { Args: { p_flag_id: string }; Returns: undefined }
      admin_delete_plan: { Args: { p_plan_id: string }; Returns: undefined }
      admin_delete_setting: { Args: { p_key: string }; Returns: undefined }
      admin_get_ai_config: {
        Args: { p_config_id: string }
        Returns: {
          api_key_masked: string
          base_url: string
          cost_caps: Json
          created_at: string
          id: string
          is_active: boolean
          knowledge_items_count: number
          models: Json
          router_rules_count: number
          settings: Json
          total_cost: number
          total_invocations: number
          total_tokens: number
          updated_at: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      admin_get_blocked_ips: {
        Args: never
        Returns: {
          blocked_at: string
          ip: string
          reason: string
        }[]
      }
      admin_get_flag: {
        Args: { p_flag_id: string }
        Returns: {
          category: string
          created_at: string
          description: Json
          id: string
          is_enabled: boolean
          key: string
          metadata: Json
          name: Json
          plan_key: string
          updated_at: string
        }[]
      }
      admin_get_plan: {
        Args: { p_plan_id: string }
        Returns: {
          active_subscriptions: number
          created_at: string
          currency: string
          description: string
          id: string
          is_active: boolean
          key: string
          limits: Json
          name: string
          plan_interval: string
          price_cents: number
          sort_order: number
          total_subscriptions: number
          trial_days: number
          updated_at: string
        }[]
      }
      admin_get_registration_status: { Args: never; Returns: boolean }
      admin_get_setting: {
        Args: { p_key: string }
        Returns: {
          description: string
          is_public: boolean
          key: string
          updated_at: string
          updated_by: string
          value: Json
        }[]
      }
      admin_get_user: {
        Args: { p_user_id: string }
        Returns: {
          ai_cost_usd: number
          avatar_url: string
          created_at: string
          email: string
          full_name: string
          last_sign_in: string
          role: string
          status: string
          user_id: string
          wa_messages_count: number
          wa_sessions_count: number
        }[]
      }
      admin_invite_user: {
        Args: { p_email: string; p_full_name?: string; p_role?: string }
        Returns: string
      }
      admin_list_ai_configs: {
        Args: {
          p_is_active?: boolean
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: {
          api_key_masked: string
          base_url: string
          cost_caps: Json
          cost_today: number
          created_at: string
          id: string
          is_active: boolean
          models: Json
          settings: Json
          total_cost: number
          total_invocations: number
          updated_at: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      admin_list_ai_invocations: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_model?: string
          p_offset?: number
          p_success?: boolean
          p_workspace_id?: string
        }
        Returns: {
          completion_tokens: number
          confidence: number
          cost_usd: number
          created_at: string
          error: string
          escalated_to_human: boolean
          id: string
          intent: string
          latency_ms: number
          level: string
          model: string
          prompt_tokens: number
          provider: string
          success: boolean
          total_tokens: number
          workspace_id: string
          workspace_name: string
        }[]
      }
      admin_list_audit_logs: {
        Args: {
          p_action?: string
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
          p_resource_type?: string
          p_search?: string
        }
        Returns: {
          action: string
          created_at: string
          description: string
          id: string
          ip: string
          metadata: Json
          resource_id: string
          resource_type: string
          total: number
          user_agent: string
          user_email: string
          user_id: string
          user_name: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      admin_list_broadcasts: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          body: string
          created_at: string
          id: string
          recipients: number
          sent_by: string
          sent_by_email: string
          title: string
          type: string
        }[]
      }
      admin_list_flags: {
        Args: { p_category?: string }
        Returns: {
          category: string
          created_at: string
          description: Json
          id: string
          is_enabled: boolean
          key: string
          metadata: Json
          name: Json
          plan_key: string
          updated_at: string
        }[]
      }
      admin_list_plans: {
        Args: never
        Returns: {
          active_subscriptions: number
          created_at: string
          currency: string
          description: string
          features: Json
          id: string
          is_active: boolean
          is_popular: boolean
          key: string
          limits: Json
          name: string
          plan_interval: string
          price_cents: number
          sort_order: number
          total_subscriptions: number
          trial_days: number
          updated_at: string
        }[]
      }
      admin_list_settings: {
        Args: { p_category?: string }
        Returns: {
          description: string
          is_public: boolean
          key: string
          updated_at: string
          updated_by: string
          value: Json
        }[]
      }
      admin_list_subscriptions: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: string
        }
        Returns: {
          canceled_at: string
          created_at: string
          current_period_end: string
          current_period_start: string
          days_remaining: number
          id: string
          plan_currency: string
          plan_id: string
          plan_interval: string
          plan_name: string
          plan_price_cents: number
          status: string
          trial_end: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      admin_list_users: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_role?: string
          p_search?: string
          p_status?: string
        }
        Returns: {
          ai_cost_usd: number
          avatar_url: string
          created_at: string
          email: string
          full_name: string
          last_sign_in: string
          role: string
          status: string
          user_id: string
          wa_messages_count: number
          wa_sessions_count: number
        }[]
      }
      admin_recent_logins: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          id: string
          ip: string
          user_agent: string
          user_email: string
          user_name: string
          workspace_name: string
        }[]
      }
      admin_reorder_plans: { Args: { p_orders: Json }; Returns: undefined }
      admin_reset_user_password: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      admin_security_overview: { Args: never; Returns: Json }
      admin_set_enforce_2fa: {
        Args: { p_enabled: boolean }
        Returns: undefined
      }
      admin_set_user_password: {
        Args: { new_password: string; target_user_id: string }
        Returns: undefined
      }
      admin_subscriptions_stats: {
        Args: never
        Returns: {
          active: number
          expired: number
          expiring: number
          mrr_cents: number
          total: number
        }[]
      }
      admin_toggle_ai_config: {
        Args: { p_config_id: string; p_is_active: boolean }
        Returns: undefined
      }
      admin_toggle_flag: {
        Args: { p_enabled: boolean; p_flag_id: string }
        Returns: undefined
      }
      admin_toggle_plan: {
        Args: { p_is_active: boolean; p_plan_id: string }
        Returns: undefined
      }
      admin_toggle_registration: {
        Args: { p_enabled: boolean }
        Returns: undefined
      }
      admin_top_ai_workspaces: {
        Args: { p_limit?: number }
        Returns: {
          avg_cost_per_invocation: number
          cost_cap_daily: number
          cost_cap_monthly: number
          invocations: number
          is_active: boolean
          success_rate: number
          total_cost: number
          workspace_id: string
          workspace_name: string
        }[]
      }
      admin_unblock_ip: { Args: { p_ip: string }; Returns: undefined }
      admin_update_ai_api_key: {
        Args: { p_api_key: string; p_config_id: string }
        Returns: undefined
      }
      admin_update_ai_config: {
        Args: {
          p_base_url?: string
          p_config_id: string
          p_cost_caps?: Json
          p_models?: Json
          p_settings?: Json
        }
        Returns: undefined
      }
      admin_update_flag: {
        Args: {
          p_category?: string
          p_description?: Json
          p_flag_id: string
          p_metadata?: Json
          p_name?: Json
          p_plan_key?: string
        }
        Returns: undefined
      }
      admin_update_plan: {
        Args: {
          p_currency?: string
          p_description?: string
          p_features?: Json
          p_interval?: string
          p_is_popular?: boolean
          p_limits?: Json
          p_name?: string
          p_plan_id: string
          p_price_cents?: number
          p_sort_order?: number
          p_trial_days?: number
        }
        Returns: undefined
      }
      admin_update_user_status: {
        Args: { p_reason?: string; p_status: string; p_user_id: string }
        Returns: undefined
      }
      admin_upsert_setting: {
        Args: {
          p_description?: string
          p_is_public?: boolean
          p_key: string
          p_value: Json
        }
        Returns: undefined
      }
      block_wa_contact: {
        Args: { p_blocked_by: string; p_contact_id: string; p_reason?: string }
        Returns: undefined
      }
      check_workspace_sessions_health: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      current_workspace_id: { Args: never; Returns: string }
      get_active_keyword_rules: {
        Args: { p_session_id: string; p_workspace_id: string }
        Returns: {
          action: string
          case_sensitive: boolean
          created_at: string
          id: string
          is_active: boolean
          keywords: string[]
          match_type: Database["public"]["Enums"]["wa_match_type"]
          name: string
          priority: number
          reply_template_id: string | null
          reply_text: string | null
          updated_at: string
          wa_session_id: string | null
          workflow_id: string | null
          workspace_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "wa_keyword_rules"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_ai_cost_today: { Args: { p_workspace_id: string }; Returns: number }
      get_session_health_summary: {
        Args: { p_workspace_id: string }
        Returns: Json
      }
      get_user_role: { Args: never; Returns: string }
      get_wa_contact_list_members: {
        Args: { p_list_id: string }
        Returns: {
          added_at: string
          contact_id: string
          email: string
          is_vip: boolean
          name: string
          phone: string
          push_name: string
          tags: string[]
        }[]
      }
      has_permission: { Args: { p_key: string }; Returns: boolean }
      increment_extraction_result_count: {
        Args: { count: number; job_id: string }
        Returns: undefined
      }
      is_registration_enabled: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      list_public_plans: {
        Args: never
        Returns: {
          currency: string
          description: string
          features: Json
          id: string
          is_active: boolean
          is_popular: boolean
          key: string
          limits: Json
          name: string
          plan_interval: string
          price_cents: number
          sort_order: number
          trial_days: number
        }[]
      }
      list_wa_contact_lists: {
        Args: { p_workspace_id: string }
        Returns: {
          color: string
          created_at: string
          description: string
          id: string
          member_count: number
          name: string
          updated_at: string
        }[]
      }
      log_activity: {
        Args: {
          p_action: Database["public"]["Enums"]["activity_action"]
          p_description?: string
          p_metadata?: Json
          p_resource_id?: string
          p_resource_type?: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: string
      }
      log_fb_session_activity: {
        Args: {
          p_action: string
          p_description?: string
          p_metadata?: Json
          p_session_id: string
        }
        Returns: undefined
      }
      log_login: { Args: never; Returns: undefined }
      log_session_activity: {
        Args: {
          p_action: string
          p_description?: string
          p_metadata?: Json
          p_session_id: string
        }
        Returns: string
      }
      log_wa_session_activity: {
        Args: {
          p_action: string
          p_description?: string
          p_metadata?: Json
          p_session_id: string
        }
        Returns: string
      }
      mark_wa_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      materialize_wa_campaign_audience: {
        Args: { p_campaign_id: string }
        Returns: number
      }
      merge_wa_contacts: {
        Args: { p_source_id: string; p_target_id: string }
        Returns: undefined
      }
      record_fb_connection_attempt: {
        Args: {
          p_duration_ms?: number
          p_error_message?: string
          p_metadata?: Json
          p_result: Database["public"]["Enums"]["connection_attempt_result"]
          p_session_id: string
        }
        Returns: undefined
      }
      record_wa_connection_attempt: {
        Args: {
          p_duration_ms?: number
          p_error_message?: string
          p_metadata?: Json
          p_result: Database["public"]["Enums"]["connection_attempt_result"]
          p_session_id: string
        }
        Returns: undefined
      }
      soft_delete_fb_session: {
        Args: { p_session_id: string }
        Returns: undefined
      }
      touch_fb_session: { Args: { p_session_id: string }; Returns: undefined }
      touch_wa_contact: { Args: { p_contact_id: string }; Returns: undefined }
      touch_wa_session: { Args: { p_session_id: string }; Returns: undefined }
      transition_fb_session_status: {
        Args: {
          p_metadata?: Json
          p_new_status: Database["public"]["Enums"]["fb_session_status"]
          p_reason?: string
          p_session_id: string
        }
        Returns: Json
      }
      transition_wa_session_status: {
        Args: {
          p_metadata?: Json
          p_new_status: Database["public"]["Enums"]["wa_session_status"]
          p_reason?: string
          p_session_id: string
        }
        Returns: Json
      }
      update_fb_session_status: {
        Args: {
          p_metadata?: Json
          p_new_status: Database["public"]["Enums"]["fb_session_status"]
          p_reason?: string
          p_session_id: string
        }
        Returns: undefined
      }
      update_wa_campaign_progress: {
        Args: {
          p_campaign_id: string
          p_error?: string
          p_recipient_id: string
          p_status: string
          p_wa_message_id?: string
        }
        Returns: undefined
      }
      upsert_wa_inbound: {
        Args: {
          p_body: string
          p_has_media?: boolean
          p_jid: string
          p_media_mime?: string
          p_phone: string
          p_push_name: string
          p_quoted_wa_id?: string
          p_timestamp?: number
          p_type: string
          p_wa_message_id: string
          p_wa_session_id: string
          p_workspace_id: string
        }
        Returns: string
      }
      user_get_notifications: {
        Args: { p_limit?: number; p_unread_only?: boolean }
        Returns: {
          body: string
          created_at: string
          id: string
          read_at: string
          title: string
          type: string
        }[]
      }
      user_mark_all_read: { Args: never; Returns: undefined }
      user_mark_notification_read: {
        Args: { p_id: string }
        Returns: undefined
      }
      user_unread_count: { Args: never; Returns: number }
      validate_fb_session: { Args: { p_session_id: string }; Returns: Json }
      validate_wa_session: { Args: { p_session_id: string }; Returns: Json }
      wa_analytics_ai_usage: {
        Args: { p_days?: number }
        Returns: {
          avg_latency_ms: number
          by_level: Json
          by_model: Json
          escalated: number
          failed: number
          successful: number
          total_cost: number
          total_invocations: number
          total_tokens: number
        }[]
      }
      wa_analytics_campaigns: {
        Args: { p_limit?: number }
        Returns: {
          campaign_id: string
          campaign_name: string
          created_at: string
          delivered_count: number
          delivery_rate: number
          failed_count: number
          read_count: number
          read_rate: number
          sent_count: number
          status: string
          total_recipients: number
          type: string
        }[]
      }
      wa_analytics_hourly_activity: {
        Args: { p_days?: number }
        Returns: {
          count: number
          day_of_week: number
          hour: number
        }[]
      }
      wa_analytics_message_trend: {
        Args: { p_days?: number }
        Returns: {
          date: string
          failed: number
          received: number
          sent: number
        }[]
      }
      wa_analytics_overview: {
        Args: { p_days?: number }
        Returns: {
          active_conversations: number
          ai_cost_usd: number
          ai_escalation_rate: number
          ai_handled_count: number
          avg_response_time_minutes: number
          delivered_count: number
          delivery_rate: number
          failed_count: number
          failure_rate: number
          new_contacts_period: number
          read_count: number
          read_rate: number
          received_messages: number
          sent_messages: number
          total_contacts: number
          total_messages: number
        }[]
      }
      wa_analytics_status_distribution: {
        Args: { p_days?: number }
        Returns: {
          count: number
          status: string
        }[]
      }
      wa_analytics_top_contacts: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          contact_id: string
          contact_name: string
          contact_phone: string
          inbound_count: number
          last_message_at: string
          messages_count: number
          outbound_count: number
        }[]
      }
      wa_analytics_type_distribution: {
        Args: { p_days?: number }
        Returns: {
          count: number
          type: string
        }[]
      }
      wa_create_quick_reply: {
        Args: {
          p_body: string
          p_category?: string
          p_shortcut: string
          p_title: string
        }
        Returns: string
      }
      wa_delete_quick_reply: { Args: { p_id: string }; Returns: undefined }
      wa_get_auto_reply_settings: {
        Args: never
        Returns: {
          away_message: string
          is_enabled: boolean
          offline_message: string
          use_business_hours: boolean
          welcome_message: string
        }[]
      }
      wa_get_business_hours: {
        Args: never
        Returns: {
          id: string
          is_enabled: boolean
          outside_hours_action: string
          outside_hours_message: string
          schedule: Json
          timezone: string
          workspace_id: string
        }[]
      }
      wa_list_quick_replies: {
        Args: { p_category?: string }
        Returns: {
          body: string
          category: string
          created_at: string
          id: string
          shortcut: string
          title: string
          updated_at: string
        }[]
      }
      wa_update_auto_reply_settings: {
        Args: {
          p_away_message?: string
          p_is_enabled?: boolean
          p_offline_message?: string
          p_use_business_hours?: boolean
          p_welcome_message?: string
        }
        Returns: undefined
      }
      wa_update_business_hours: {
        Args: {
          p_is_enabled?: boolean
          p_outside_hours_action?: string
          p_outside_hours_message?: string
          p_schedule?: Json
          p_timezone?: string
        }
        Returns: undefined
      }
      wa_update_quick_reply: {
        Args: {
          p_body?: string
          p_category?: string
          p_id: string
          p_shortcut?: string
          p_title?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      activity_action:
        | "login"
        | "logout"
        | "signup"
        | "password_change"
        | "subscription_change"
        | "subscription_cancel"
        | "facebook_connect"
        | "facebook_disconnect"
        | "extraction_created"
        | "extraction_completed"
        | "extraction_failed"
        | "export_created"
        | "export_completed"
        | "role_change"
        | "profile_update"
        | "workspace_update"
        | "admin_action"
        | "user_suspend"
        | "user_activate"
      ai_provider: "kie"
      ai_route_level: "l1" | "l2" | "l3" | "human"
      connection_attempt_result:
        | "success"
        | "auth_failed"
        | "network_error"
        | "timeout"
        | "validation_failed"
        | "session_expired"
        | "unknown_error"
      export_format: "csv" | "json" | "xlsx"
      export_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "expired"
      extraction_type:
        | "leads"
        | "pages"
        | "groups"
        | "ads"
        | "marketplace"
        | "insights"
        | "post_comments"
        | "post_reactions"
        | "custom"
        | "messenger_contacts"
      fb_account_status:
        | "connected"
        | "disconnected"
        | "expired"
        | "error"
        | "revoked"
      fb_session_event_type:
        | "created"
        | "connected"
        | "disconnected"
        | "reconnected"
        | "refreshed"
        | "renamed"
        | "paused"
        | "resumed"
        | "expired"
        | "error"
        | "deleted"
        | "duplicated"
        | "viewed"
      fb_session_status:
        | "connected"
        | "connecting"
        | "disconnected"
        | "expired"
        | "paused"
        | "error"
        | "reconnecting"
      invoice_status: "draft" | "open" | "paid" | "void" | "uncollectible"
      job_status:
        | "queued"
        | "running"
        | "completed"
        | "failed"
        | "canceled"
        | "paused"
      notification_type: "info" | "success" | "warning" | "error" | "system"
      plan_interval: "monthly" | "yearly"
      session_health: "healthy" | "degraded" | "unhealthy" | "unknown"
      subscription_status:
        | "active"
        | "trialing"
        | "past_due"
        | "canceled"
        | "expired"
        | "paused"
      user_status: "active" | "pending" | "suspended" | "expired" | "deleted"
      wa_automation_status: "active" | "paused" | "draft"
      wa_campaign_status:
        | "draft"
        | "scheduled"
        | "running"
        | "paused"
        | "completed"
        | "failed"
        | "canceled"
      wa_contact_status: "active" | "blocked" | "archived" | "deleted"
      wa_match_type:
        | "equals"
        | "contains"
        | "regex"
        | "starts_with"
        | "ends_with"
      wa_message_direction: "inbound" | "outbound" | "system"
      wa_message_status: "pending" | "sent" | "delivered" | "read" | "failed"
      wa_message_type:
        | "text"
        | "image"
        | "video"
        | "audio"
        | "document"
        | "location"
        | "contact"
        | "buttons"
        | "list"
        | "template"
      wa_provider_type: "baileys" | "cloud_api"
      wa_session_status:
        | "disconnected"
        | "qr_ready"
        | "authenticating"
        | "connecting"
        | "connected"
        | "reconnecting"
        | "paused"
        | "expired"
        | "error"
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
      activity_action: [
        "login",
        "logout",
        "signup",
        "password_change",
        "subscription_change",
        "subscription_cancel",
        "facebook_connect",
        "facebook_disconnect",
        "extraction_created",
        "extraction_completed",
        "extraction_failed",
        "export_created",
        "export_completed",
        "role_change",
        "profile_update",
        "workspace_update",
        "admin_action",
        "user_suspend",
        "user_activate",
      ],
      ai_provider: ["kie"],
      ai_route_level: ["l1", "l2", "l3", "human"],
      connection_attempt_result: [
        "success",
        "auth_failed",
        "network_error",
        "timeout",
        "validation_failed",
        "session_expired",
        "unknown_error",
      ],
      export_format: ["csv", "json", "xlsx"],
      export_status: [
        "pending",
        "processing",
        "completed",
        "failed",
        "expired",
      ],
      extraction_type: [
        "leads",
        "pages",
        "groups",
        "ads",
        "marketplace",
        "insights",
        "post_comments",
        "post_reactions",
        "custom",
        "messenger_contacts",
      ],
      fb_account_status: [
        "connected",
        "disconnected",
        "expired",
        "error",
        "revoked",
      ],
      fb_session_event_type: [
        "created",
        "connected",
        "disconnected",
        "reconnected",
        "refreshed",
        "renamed",
        "paused",
        "resumed",
        "expired",
        "error",
        "deleted",
        "duplicated",
        "viewed",
      ],
      fb_session_status: [
        "connected",
        "connecting",
        "disconnected",
        "expired",
        "paused",
        "error",
        "reconnecting",
      ],
      invoice_status: ["draft", "open", "paid", "void", "uncollectible"],
      job_status: [
        "queued",
        "running",
        "completed",
        "failed",
        "canceled",
        "paused",
      ],
      notification_type: ["info", "success", "warning", "error", "system"],
      plan_interval: ["monthly", "yearly"],
      session_health: ["healthy", "degraded", "unhealthy", "unknown"],
      subscription_status: [
        "active",
        "trialing",
        "past_due",
        "canceled",
        "expired",
        "paused",
      ],
      user_status: ["active", "pending", "suspended", "expired", "deleted"],
      wa_automation_status: ["active", "paused", "draft"],
      wa_campaign_status: [
        "draft",
        "scheduled",
        "running",
        "paused",
        "completed",
        "failed",
        "canceled",
      ],
      wa_contact_status: ["active", "blocked", "archived", "deleted"],
      wa_match_type: [
        "equals",
        "contains",
        "regex",
        "starts_with",
        "ends_with",
      ],
      wa_message_direction: ["inbound", "outbound", "system"],
      wa_message_status: ["pending", "sent", "delivered", "read", "failed"],
      wa_message_type: [
        "text",
        "image",
        "video",
        "audio",
        "document",
        "location",
        "contact",
        "buttons",
        "list",
        "template",
      ],
      wa_provider_type: ["baileys", "cloud_api"],
      wa_session_status: [
        "disconnected",
        "qr_ready",
        "authenticating",
        "connecting",
        "connected",
        "reconnecting",
        "paused",
        "expired",
        "error",
      ],
    },
  },
} as const
