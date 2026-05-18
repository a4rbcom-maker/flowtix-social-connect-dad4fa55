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
        ]
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
      whatsapp_settings: {
        Row: {
          ai_business_hours_only: boolean | null
          ai_enabled: boolean
          ai_model: string | null
          ai_system_prompt: string | null
          ai_welcome_message: string | null
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
          ai_business_hours_only?: boolean | null
          ai_enabled?: boolean
          ai_model?: string | null
          ai_system_prompt?: string | null
          ai_welcome_message?: string | null
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
          ai_business_hours_only?: boolean | null
          ai_enabled?: boolean
          ai_model?: string | null
          ai_system_prompt?: string | null
          ai_welcome_message?: string | null
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
      fb_job_status:
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
      fb_job_type:
        | "post_to_groups"
        | "extract_pages"
        | "extract_commenters"
        | "test_account"
      fb_result_status: "success" | "failed" | "skipped"
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
      fb_job_status: ["pending", "running", "completed", "failed", "cancelled"],
      fb_job_type: [
        "post_to_groups",
        "extract_pages",
        "extract_commenters",
        "test_account",
      ],
      fb_result_status: ["success", "failed", "skipped"],
      schedule_status: ["scheduled", "sending", "sent", "failed", "cancelled"],
      send_channel: ["whatsapp", "facebook", "bulk", "system"],
      send_status: ["pending", "processing", "success", "failed"],
    },
  },
} as const
