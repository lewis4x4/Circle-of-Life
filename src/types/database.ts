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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          created_at: string
          default_day_of_week: number[] | null
          default_duration_minutes: number | null
          default_start_time: string | null
          deleted_at: string | null
          description: string | null
          facilitator: string | null
          facility_id: string
          id: string
          is_recurring: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_day_of_week?: number[] | null
          default_duration_minutes?: number | null
          default_start_time?: string | null
          deleted_at?: string | null
          description?: string | null
          facilitator?: string | null
          facility_id: string
          id?: string
          is_recurring?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_day_of_week?: number[] | null
          default_duration_minutes?: number | null
          default_start_time?: string | null
          deleted_at?: string | null
          description?: string | null
          facilitator?: string | null
          facility_id?: string
          id?: string
          is_recurring?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_attendance: {
        Row: {
          activity_session_id: string
          attended: boolean
          created_at: string
          deleted_at: string | null
          duration_minutes: number | null
          engagement_level: string | null
          facility_id: string
          id: string
          logged_by: string
          notes: string | null
          organization_id: string
          resident_id: string
        }
        Insert: {
          activity_session_id: string
          attended?: boolean
          created_at?: string
          deleted_at?: string | null
          duration_minutes?: number | null
          engagement_level?: string | null
          facility_id: string
          id?: string
          logged_by: string
          notes?: string | null
          organization_id: string
          resident_id: string
        }
        Update: {
          activity_session_id?: string
          attended?: boolean
          created_at?: string
          deleted_at?: string | null
          duration_minutes?: number | null
          engagement_level?: string | null
          facility_id?: string
          id?: string
          logged_by?: string
          notes?: string | null
          organization_id?: string
          resident_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_attendance_activity_session_id_fkey"
            columns: ["activity_session_id"]
            isOneToOne: false
            referencedRelation: "activity_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_attendance_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_attendance_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_attendance_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_sessions: {
        Row: {
          activity_id: string
          cancel_reason: string | null
          cancelled: boolean
          created_at: string
          deleted_at: string | null
          end_time: string | null
          facilitator_name: string | null
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          session_date: string
          start_time: string | null
        }
        Insert: {
          activity_id: string
          cancel_reason?: string | null
          cancelled?: boolean
          created_at?: string
          deleted_at?: string | null
          end_time?: string | null
          facilitator_name?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          session_date: string
          start_time?: string | null
        }
        Update: {
          activity_id?: string
          cancel_reason?: string | null
          cancelled?: boolean
          created_at?: string
          deleted_at?: string | null
          end_time?: string | null
          facilitator_name?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          session_date?: string
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_sessions_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_sessions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      adl_logs: {
        Row: {
          adl_type: string
          assistance_level: Database["public"]["Enums"]["assistance_level"]
          assisting_staff_ids: string[] | null
          created_at: string
          daily_log_id: string | null
          deleted_at: string | null
          detail_data: Json
          duration_seconds: number | null
          facility_id: string
          id: string
          log_date: string
          log_time: string
          logged_by: string
          notes: string | null
          organization_id: string
          refusal_reason: string | null
          refused: boolean
          resident_id: string
          shift: Database["public"]["Enums"]["shift_type"]
        }
        Insert: {
          adl_type: string
          assistance_level: Database["public"]["Enums"]["assistance_level"]
          assisting_staff_ids?: string[] | null
          created_at?: string
          daily_log_id?: string | null
          deleted_at?: string | null
          detail_data?: Json
          duration_seconds?: number | null
          facility_id: string
          id?: string
          log_date: string
          log_time?: string
          logged_by: string
          notes?: string | null
          organization_id: string
          refusal_reason?: string | null
          refused?: boolean
          resident_id: string
          shift: Database["public"]["Enums"]["shift_type"]
        }
        Update: {
          adl_type?: string
          assistance_level?: Database["public"]["Enums"]["assistance_level"]
          assisting_staff_ids?: string[] | null
          created_at?: string
          daily_log_id?: string | null
          deleted_at?: string | null
          detail_data?: Json
          duration_seconds?: number | null
          facility_id?: string
          id?: string
          log_date?: string
          log_time?: string
          logged_by?: string
          notes?: string | null
          organization_id?: string
          refusal_reason?: string | null
          refused?: boolean
          resident_id?: string
          shift?: Database["public"]["Enums"]["shift_type"]
        }
        Relationships: [
          {
            foreignKeyName: "adl_logs_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adl_logs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adl_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "adl_logs_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_case_rate_terms: {
        Row: {
          accommodation_type: Database["public"]["Enums"]["admission_accommodation_quote"]
          admission_case_id: string
          created_at: string
          created_by: string | null
          effective_date: string | null
          id: string
          notes: string | null
          quoted_base_rate_cents: number
          quoted_care_surcharge_cents: number
          rate_schedule_id: string | null
        }
        Insert: {
          accommodation_type: Database["public"]["Enums"]["admission_accommodation_quote"]
          admission_case_id: string
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          id?: string
          notes?: string | null
          quoted_base_rate_cents: number
          quoted_care_surcharge_cents?: number
          rate_schedule_id?: string | null
        }
        Update: {
          accommodation_type?: Database["public"]["Enums"]["admission_accommodation_quote"]
          admission_case_id?: string
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          id?: string
          notes?: string | null
          quoted_base_rate_cents?: number
          quoted_care_surcharge_cents?: number
          rate_schedule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admission_case_rate_terms_admission_case_id_fkey"
            columns: ["admission_case_id"]
            isOneToOne: false
            referencedRelation: "admission_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_case_rate_terms_rate_schedule_id_fkey"
            columns: ["rate_schedule_id"]
            isOneToOne: false
            referencedRelation: "rate_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      admission_cases: {
        Row: {
          bed_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          financial_clearance_at: string | null
          financial_clearance_by: string | null
          id: string
          notes: string | null
          organization_id: string
          physician_orders_received_at: string | null
          physician_orders_summary: string | null
          referral_lead_id: string | null
          resident_id: string
          status: Database["public"]["Enums"]["admission_case_status"]
          target_move_in_date: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bed_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          financial_clearance_at?: string | null
          financial_clearance_by?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          physician_orders_received_at?: string | null
          physician_orders_summary?: string | null
          referral_lead_id?: string | null
          resident_id: string
          status?: Database["public"]["Enums"]["admission_case_status"]
          target_move_in_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bed_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          financial_clearance_at?: string | null
          financial_clearance_by?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          physician_orders_received_at?: string | null
          physician_orders_summary?: string | null
          referral_lead_id?: string | null
          resident_id?: string
          status?: Database["public"]["Enums"]["admission_case_status"]
          target_move_in_date?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admission_cases_bed_id_fkey"
            columns: ["bed_id"]
            isOneToOne: false
            referencedRelation: "beds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_cases_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_cases_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_cases_referral_lead_id_fkey"
            columns: ["referral_lead_id"]
            isOneToOne: false
            referencedRelation: "referral_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admission_cases_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      advance_directive_documents: {
        Row: {
          code_status: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          document_type: string
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          physician_signature_date: string | null
          polst_status: Database["public"]["Enums"]["polst_status"]
          resident_id: string
          scanned_document_storage_path: string | null
          updated_at: string
          updated_by: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          code_status?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_type?: string
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          physician_signature_date?: string | null
          polst_status?: Database["public"]["Enums"]["polst_status"]
          resident_id: string
          scanned_document_storage_path?: string | null
          updated_at?: string
          updated_by?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          code_status?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_type?: string
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          physician_signature_date?: string | null
          polst_status?: Database["public"]["Enums"]["polst_status"]
          resident_id?: string
          scanned_document_storage_path?: string | null
          updated_at?: string
          updated_by?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "advance_directive_documents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advance_directive_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advance_directive_documents_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_invocation_policies: {
        Row: {
          allow_phi: boolean
          created_at: string
          default_provider: string
          id: string
          organization_id: string
          routing_json: Json
          updated_at: string
        }
        Insert: {
          allow_phi?: boolean
          created_at?: string
          default_provider?: string
          id?: string
          organization_id: string
          routing_json?: Json
          updated_at?: string
        }
        Update: {
          allow_phi?: boolean
          created_at?: string
          default_provider?: string
          id?: string
          organization_id?: string
          routing_json?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_invocation_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_invocations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          metadata_json: Json
          model: string
          organization_id: string
          phi_class: Database["public"]["Enums"]["ai_phi_class"]
          prompt_hash: string
          response_hash: string | null
          tokens_used: number | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          metadata_json?: Json
          model: string
          organization_id: string
          phi_class?: Database["public"]["Enums"]["ai_phi_class"]
          prompt_hash: string
          response_hash?: string | null
          tokens_used?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          metadata_json?: Json
          model?: string
          organization_id?: string
          phi_class?: Database["public"]["Enums"]["ai_phi_class"]
          prompt_hash?: string
          response_hash?: string | null
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_invocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_templates: {
        Row: {
          assessment_type: string
          created_at: string
          default_frequency_days: number
          description: string | null
          id: string
          items: Json
          name: string
          required_role: Database["public"]["Enums"]["app_role"][]
          risk_thresholds: Json
          score_range_max: number | null
          score_range_min: number | null
        }
        Insert: {
          assessment_type: string
          created_at?: string
          default_frequency_days: number
          description?: string | null
          id?: string
          items: Json
          name: string
          required_role: Database["public"]["Enums"]["app_role"][]
          risk_thresholds: Json
          score_range_max?: number | null
          score_range_min?: number | null
        }
        Update: {
          assessment_type?: string
          created_at?: string
          default_frequency_days?: number
          description?: string | null
          id?: string
          items?: Json
          name?: string
          required_role?: Database["public"]["Enums"]["app_role"][]
          risk_thresholds?: Json
          score_range_max?: number | null
          score_range_min?: number | null
        }
        Relationships: []
      }
      assessments: {
        Row: {
          assessed_by: string
          assessment_date: string
          assessment_type: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          next_due_date: string | null
          notes: string | null
          organization_id: string
          resident_id: string
          risk_level: string | null
          scores: Json
          total_score: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assessed_by: string
          assessment_date: string
          assessment_type: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          next_due_date?: string | null
          notes?: string | null
          organization_id: string
          resident_id: string
          risk_level?: string | null
          scores?: Json
          total_score?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assessed_by?: string
          assessment_date?: string
          assessment_type?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          next_due_date?: string | null
          notes?: string | null
          organization_id?: string
          resident_id?: string
          risk_level?: string | null
          scores?: Json
          total_score?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changed_fields: string[] | null
          created_at: string
          facility_id: string | null
          id: string
          ip_address: unknown
          new_data: Json | null
          old_data: Json | null
          organization_id: string | null
          record_id: string
          table_name: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changed_fields?: string[] | null
          created_at?: string
          facility_id?: string | null
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          organization_id?: string | null
          record_id: string
          table_name: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changed_fields?: string[] | null
          created_at?: string
          facility_id?: string | null
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          organization_id?: string | null
          record_id?: string
          table_name?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      audit_log_export_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          date_from: string | null
          date_to: string | null
          deleted_at: string | null
          error_message: string | null
          facility_id: string | null
          format: Database["public"]["Enums"]["audit_log_export_format"]
          id: string
          organization_id: string
          requested_by: string
          row_count: number | null
          sha256_checksum: string | null
          status: Database["public"]["Enums"]["audit_log_export_status"]
          storage_path: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          deleted_at?: string | null
          error_message?: string | null
          facility_id?: string | null
          format?: Database["public"]["Enums"]["audit_log_export_format"]
          id?: string
          organization_id: string
          requested_by: string
          row_count?: number | null
          sha256_checksum?: string | null
          status?: Database["public"]["Enums"]["audit_log_export_status"]
          storage_path?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          date_from?: string | null
          date_to?: string | null
          deleted_at?: string | null
          error_message?: string | null
          facility_id?: string | null
          format?: Database["public"]["Enums"]["audit_log_export_format"]
          id?: string
          organization_id?: string
          requested_by?: string
          row_count?: number | null
          sha256_checksum?: string | null
          status?: Database["public"]["Enums"]["audit_log_export_status"]
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_export_jobs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_export_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      beds: {
        Row: {
          bed_label: string
          bed_type: Database["public"]["Enums"]["bed_type"]
          created_at: string
          created_by: string | null
          current_resident_id: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          organization_id: string
          room_id: string
          status: Database["public"]["Enums"]["bed_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bed_label: string
          bed_type?: Database["public"]["Enums"]["bed_type"]
          created_at?: string
          created_by?: string | null
          current_resident_id?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          organization_id: string
          room_id: string
          status?: Database["public"]["Enums"]["bed_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bed_label?: string
          bed_type?: Database["public"]["Enums"]["bed_type"]
          created_at?: string
          created_by?: string | null
          current_resident_id?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          room_id?: string
          status?: Database["public"]["Enums"]["bed_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "beds_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beds_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_beds_resident"
            columns: ["current_resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      behavioral_logs: {
        Row: {
          antecedent: string | null
          behavior: string
          behavior_type: string
          consequence: string | null
          created_at: string
          daily_log_id: string | null
          deleted_at: string | null
          duration_minutes: number | null
          facility_id: string
          family_notified: boolean
          family_notified_at: string | null
          id: string
          injury_details: string | null
          injury_occurred: boolean
          intervention_effective: boolean | null
          intervention_used: string[] | null
          involved_residents: string[] | null
          involved_staff: string[] | null
          logged_by: string
          notes: string | null
          occurred_at: string
          organization_id: string
          physician_notified: boolean
          physician_notified_at: string | null
          resident_id: string
          shift: Database["public"]["Enums"]["shift_type"]
        }
        Insert: {
          antecedent?: string | null
          behavior: string
          behavior_type: string
          consequence?: string | null
          created_at?: string
          daily_log_id?: string | null
          deleted_at?: string | null
          duration_minutes?: number | null
          facility_id: string
          family_notified?: boolean
          family_notified_at?: string | null
          id?: string
          injury_details?: string | null
          injury_occurred?: boolean
          intervention_effective?: boolean | null
          intervention_used?: string[] | null
          involved_residents?: string[] | null
          involved_staff?: string[] | null
          logged_by: string
          notes?: string | null
          occurred_at?: string
          organization_id: string
          physician_notified?: boolean
          physician_notified_at?: string | null
          resident_id: string
          shift: Database["public"]["Enums"]["shift_type"]
        }
        Update: {
          antecedent?: string | null
          behavior?: string
          behavior_type?: string
          consequence?: string | null
          created_at?: string
          daily_log_id?: string | null
          deleted_at?: string | null
          duration_minutes?: number | null
          facility_id?: string
          family_notified?: boolean
          family_notified_at?: string | null
          id?: string
          injury_details?: string | null
          injury_occurred?: boolean
          intervention_effective?: boolean | null
          intervention_used?: string[] | null
          involved_residents?: string[] | null
          involved_staff?: string[] | null
          logged_by?: string
          notes?: string | null
          occurred_at?: string
          organization_id?: string
          physician_notified?: boolean
          physician_notified_at?: string | null
          resident_id?: string
          shift?: Database["public"]["Enums"]["shift_type"]
        }
        Relationships: [
          {
            foreignKeyName: "behavioral_logs_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "behavioral_logs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "behavioral_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "behavioral_logs_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmark_cohorts: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          facility_ids: string[]
          id: string
          minimum_n: number
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          facility_ids?: string[]
          id?: string
          minimum_n?: number
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          facility_ids?: string[]
          id?: string
          minimum_n?: number
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benchmark_cohorts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_change_tasks: {
        Row: {
          care_plan_id: string
          created_at: string
          deleted_at: string | null
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          resident_id: string
          status: string
          title: string
          trigger_assessment_id: string | null
          updated_at: string
        }
        Insert: {
          care_plan_id: string
          created_at?: string
          deleted_at?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          resident_id: string
          status?: string
          title: string
          trigger_assessment_id?: string | null
          updated_at?: string
        }
        Update: {
          care_plan_id?: string
          created_at?: string
          deleted_at?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          resident_id?: string
          status?: string
          title?: string
          trigger_assessment_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_change_tasks_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_change_tasks_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_change_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_change_tasks_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_change_tasks_trigger_assessment_id_fkey"
            columns: ["trigger_assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_items: {
        Row: {
          assistance_level: Database["public"]["Enums"]["assistance_level"]
          care_plan_id: string
          category: Database["public"]["Enums"]["care_plan_item_category"]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string
          facility_id: string
          frequency: string | null
          goal: string | null
          id: string
          interventions: string[] | null
          is_active: boolean
          organization_id: string
          resident_id: string
          sort_order: number
          special_instructions: string | null
          specific_times: string[] | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assistance_level: Database["public"]["Enums"]["assistance_level"]
          care_plan_id: string
          category: Database["public"]["Enums"]["care_plan_item_category"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description: string
          facility_id: string
          frequency?: string | null
          goal?: string | null
          id?: string
          interventions?: string[] | null
          is_active?: boolean
          organization_id: string
          resident_id: string
          sort_order?: number
          special_instructions?: string | null
          specific_times?: string[] | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assistance_level?: Database["public"]["Enums"]["assistance_level"]
          care_plan_id?: string
          category?: Database["public"]["Enums"]["care_plan_item_category"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string
          facility_id?: string
          frequency?: string | null
          goal?: string | null
          id?: string
          interventions?: string[] | null
          is_active?: boolean
          organization_id?: string
          resident_id?: string
          sort_order?: number
          special_instructions?: string | null
          specific_times?: string[] | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_items_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_items_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_items_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_review_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          care_plan_id: string
          created_at: string
          deleted_at: string | null
          facility_id: string
          id: string
          organization_id: string
          resident_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          trigger_detail: string | null
          trigger_source_id: string | null
          trigger_type: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          care_plan_id: string
          created_at?: string
          deleted_at?: string | null
          facility_id: string
          id?: string
          organization_id: string
          resident_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          trigger_detail?: string | null
          trigger_source_id?: string | null
          trigger_type: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          care_plan_id?: string
          created_at?: string
          deleted_at?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          resident_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          trigger_detail?: string | null
          trigger_source_id?: string | null
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_review_alerts_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_review_alerts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_review_alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_review_alerts_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan_tasks: {
        Row: {
          assistance_level: Database["public"]["Enums"]["assistance_level"]
          care_plan_item_id: string
          category: Database["public"]["Enums"]["care_plan_item_category"]
          completed_at: string | null
          completed_by: string | null
          completion_notes: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          facility_id: string
          id: string
          organization_id: string
          resident_id: string
          scheduled_time: string | null
          shift: Database["public"]["Enums"]["shift_type"] | null
          skip_reason: string | null
          status: string
          task_date: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assistance_level: Database["public"]["Enums"]["assistance_level"]
          care_plan_item_id: string
          category: Database["public"]["Enums"]["care_plan_item_category"]
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          facility_id: string
          id?: string
          organization_id: string
          resident_id: string
          scheduled_time?: string | null
          shift?: Database["public"]["Enums"]["shift_type"] | null
          skip_reason?: string | null
          status?: string
          task_date: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assistance_level?: Database["public"]["Enums"]["assistance_level"]
          care_plan_item_id?: string
          category?: Database["public"]["Enums"]["care_plan_item_category"]
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          resident_id?: string
          scheduled_time?: string | null
          shift?: Database["public"]["Enums"]["shift_type"] | null
          skip_reason?: string | null
          status?: string
          task_date?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_tasks_care_plan_item_id_fkey"
            columns: ["care_plan_item_id"]
            isOneToOne: false
            referencedRelation: "care_plan_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_tasks_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_tasks_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plans: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          billing_snapshot_hash: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          effective_date: string
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          previous_version_id: string | null
          resident_id: string
          review_due_date: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["care_plan_status"]
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          billing_snapshot_hash?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          effective_date: string
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          previous_version_id?: string | null
          resident_id: string
          review_due_date: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["care_plan_status"]
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          billing_snapshot_hash?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          effective_date?: string
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          previous_version_id?: string | null
          resident_id?: string
          review_due_date?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["care_plan_status"]
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "care_plans_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plans_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "care_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plans_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      census_daily_log: {
        Row: {
          admissions_today: number
          available_beds: number
          created_at: string
          discharges_today: number
          facility_id: string
          hold_beds: number
          id: string
          log_date: string
          maintenance_beds: number
          occupancy_rate: number
          occupied_beds: number
          organization_id: string
          residents_by_acuity: Json
          residents_by_payer: Json
          total_licensed_beds: number
        }
        Insert: {
          admissions_today?: number
          available_beds: number
          created_at?: string
          discharges_today?: number
          facility_id: string
          hold_beds: number
          id?: string
          log_date: string
          maintenance_beds: number
          occupancy_rate: number
          occupied_beds: number
          organization_id: string
          residents_by_acuity?: Json
          residents_by_payer?: Json
          total_licensed_beds: number
        }
        Update: {
          admissions_today?: number
          available_beds?: number
          created_at?: string
          discharges_today?: number
          facility_id?: string
          hold_beds?: number
          id?: string
          log_date?: string
          maintenance_beds?: number
          occupancy_rate?: number
          occupied_beds?: number
          organization_id?: string
          residents_by_acuity?: Json
          residents_by_payer?: Json
          total_licensed_beds?: number
        }
        Relationships: [
          {
            foreignKeyName: "census_daily_log_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "census_daily_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      certificates_of_insurance: {
        Row: {
          additional_insured: boolean
          aggregate_limit_cents: number | null
          ai_extracted_json: Json | null
          carrier_name: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          document_storage_path: string | null
          effective_date: string
          endorsement_summary: string | null
          entity_id: string | null
          expiration_date: string
          holder_name: string
          holder_type: Database["public"]["Enums"]["coi_holder_type"]
          id: string
          notes: string | null
          organization_id: string
          policy_number: string | null
          updated_at: string
          updated_by: string | null
          waiver_of_subrogation: boolean
        }
        Insert: {
          additional_insured?: boolean
          aggregate_limit_cents?: number | null
          ai_extracted_json?: Json | null
          carrier_name: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_storage_path?: string | null
          effective_date: string
          endorsement_summary?: string | null
          entity_id?: string | null
          expiration_date: string
          holder_name: string
          holder_type?: Database["public"]["Enums"]["coi_holder_type"]
          id?: string
          notes?: string | null
          organization_id: string
          policy_number?: string | null
          updated_at?: string
          updated_by?: string | null
          waiver_of_subrogation?: boolean
        }
        Update: {
          additional_insured?: boolean
          aggregate_limit_cents?: number | null
          ai_extracted_json?: Json | null
          carrier_name?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_storage_path?: string | null
          effective_date?: string
          endorsement_summary?: string | null
          entity_id?: string | null
          expiration_date?: string
          holder_name?: string
          holder_type?: Database["public"]["Enums"]["coi_holder_type"]
          id?: string
          notes?: string | null
          organization_id?: string
          policy_number?: string | null
          updated_at?: string
          updated_by?: string | null
          waiver_of_subrogation?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "certificates_of_insurance_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificates_of_insurance_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          input_mode: string | null
          route_at_start: string | null
          title: string | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          input_mode?: string | null
          route_at_start?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          input_mode?: string | null
          route_at_start?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          classifier_output: Json | null
          content: string
          conversation_id: string
          created_at: string
          feedback: string | null
          id: string
          model: string | null
          role: string
          sources: Json | null
          tokens_in: number | null
          tokens_out: number | null
          trace_id: string | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          classifier_output?: Json | null
          content: string
          conversation_id: string
          created_at?: string
          feedback?: string | null
          id?: string
          model?: string | null
          role: string
          sources?: Json | null
          tokens_in?: number | null
          tokens_out?: number | null
          trace_id?: string | null
          user_id?: string | null
          workspace_id?: string
        }
        Update: {
          classifier_output?: Json | null
          content?: string
          conversation_id?: string
          created_at?: string
          feedback?: string | null
          id?: string
          model?: string | null
          role?: string
          sources?: Json | null
          tokens_in?: number | null
          tokens_out?: number | null
          trace_id?: string | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      chunks: {
        Row: {
          chunk_index: number
          chunk_type: string | null
          content: string
          content_stripped: string | null
          created_at: string
          document_id: string
          embedding: string | null
          fts: unknown
          id: string
          metadata: Json | null
          page_number: number | null
          parent_chunk_id: string | null
          section_title: string | null
          token_count: number | null
          workspace_id: string
        }
        Insert: {
          chunk_index: number
          chunk_type?: string | null
          content: string
          content_stripped?: string | null
          created_at?: string
          document_id: string
          embedding?: string | null
          fts?: unknown
          id?: string
          metadata?: Json | null
          page_number?: number | null
          parent_chunk_id?: string | null
          section_title?: string | null
          token_count?: number | null
          workspace_id?: string
        }
        Update: {
          chunk_index?: number
          chunk_type?: string | null
          content?: string
          content_stripped?: string | null
          created_at?: string
          document_id?: string
          embedding?: string | null
          fts?: unknown
          id?: string
          metadata?: Json | null
          page_number?: number | null
          parent_chunk_id?: string | null
          section_title?: string | null
          token_count?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chunks_parent_chunk_id_fkey"
            columns: ["parent_chunk_id"]
            isOneToOne: false
            referencedRelation: "chunks"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_activities: {
        Row: {
          activity_date: string
          activity_type: string
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          insurance_claim_id: string
          organization_id: string
          performed_by: string
        }
        Insert: {
          activity_date: string
          activity_type: string
          created_at?: string
          deleted_at?: string | null
          description: string
          id?: string
          insurance_claim_id: string
          organization_id: string
          performed_by: string
        }
        Update: {
          activity_date?: string
          activity_type?: string
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          insurance_claim_id?: string
          organization_id?: string
          performed_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_activities_insurance_claim_id_fkey"
            columns: ["insurance_claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_activities: {
        Row: {
          activity_date: string
          activity_type: string
          created_at: string
          deleted_at: string | null
          description: string
          facility_id: string
          follow_up_date: string | null
          follow_up_notes: string | null
          id: string
          invoice_id: string | null
          organization_id: string
          outcome: string | null
          performed_by: string
          resident_id: string
        }
        Insert: {
          activity_date: string
          activity_type: string
          created_at?: string
          deleted_at?: string | null
          description: string
          facility_id: string
          follow_up_date?: string | null
          follow_up_notes?: string | null
          id?: string
          invoice_id?: string | null
          organization_id: string
          outcome?: string | null
          performed_by: string
          resident_id: string
        }
        Update: {
          activity_date?: string
          activity_type?: string
          created_at?: string
          deleted_at?: string | null
          description?: string
          facility_id?: string
          follow_up_date?: string | null
          follow_up_notes?: string | null
          id?: string
          invoice_id?: string | null
          organization_id?: string
          outcome?: string | null
          performed_by?: string
          resident_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_activities_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_activities_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_activities_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      competency_demonstrations: {
        Row: {
          attachments: Json
          created_at: string
          created_by: string | null
          deleted_at: string | null
          demonstrated_at: string
          evaluator_user_id: string
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          skills_json: Json
          staff_id: string
          status: Database["public"]["Enums"]["competency_demonstration_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          attachments?: Json
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          demonstrated_at?: string
          evaluator_user_id: string
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          skills_json?: Json
          staff_id: string
          status?: Database["public"]["Enums"]["competency_demonstration_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          attachments?: Json
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          demonstrated_at?: string
          evaluator_user_id?: string
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          skills_json?: Json
          staff_id?: string
          status?: Database["public"]["Enums"]["competency_demonstration_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competency_demonstrations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competency_demonstrations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competency_demonstrations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_survey_visit_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string
          deleted_at: string | null
          facility_id: string
          id: string
          organization_id: string
          survey_visit_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          facility_id: string
          id?: string
          organization_id: string
          survey_visit_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          survey_visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_survey_visit_notes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_survey_visit_notes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_survey_visit_notes_survey_visit_id_fkey"
            columns: ["survey_visit_id"]
            isOneToOne: false
            referencedRelation: "compliance_survey_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_survey_visits: {
        Row: {
          agency: string
          created_at: string
          deleted_at: string | null
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          updated_at: string
          visit_date: string
          visit_type: string
        }
        Insert: {
          agency?: string
          created_at?: string
          deleted_at?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          updated_at?: string
          visit_date: string
          visit_type?: string
        }
        Update: {
          agency?: string
          created_at?: string
          deleted_at?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
          visit_date?: string
          visit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_survey_visits_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_survey_visits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      condition_changes: {
        Row: {
          care_plan_review_triggered: boolean
          change_type: string
          created_at: string
          deleted_at: string | null
          description: string
          facility_id: string
          family_notified: boolean
          family_notified_at: string | null
          id: string
          linked_incident_id: string | null
          nurse_notified: boolean
          nurse_notified_at: string | null
          nurse_notified_by: string | null
          organization_id: string
          physician_notified: boolean
          physician_notified_at: string | null
          physician_response: string | null
          reported_at: string
          reported_by: string
          resident_id: string
          resolution_notes: string | null
          resolved_at: string | null
          severity: string
          shift: Database["public"]["Enums"]["shift_type"]
        }
        Insert: {
          care_plan_review_triggered?: boolean
          change_type: string
          created_at?: string
          deleted_at?: string | null
          description: string
          facility_id: string
          family_notified?: boolean
          family_notified_at?: string | null
          id?: string
          linked_incident_id?: string | null
          nurse_notified?: boolean
          nurse_notified_at?: string | null
          nurse_notified_by?: string | null
          organization_id: string
          physician_notified?: boolean
          physician_notified_at?: string | null
          physician_response?: string | null
          reported_at?: string
          reported_by: string
          resident_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          severity?: string
          shift: Database["public"]["Enums"]["shift_type"]
        }
        Update: {
          care_plan_review_triggered?: boolean
          change_type?: string
          created_at?: string
          deleted_at?: string | null
          description?: string
          facility_id?: string
          family_notified?: boolean
          family_notified_at?: string | null
          id?: string
          linked_incident_id?: string | null
          nurse_notified?: boolean
          nurse_notified_at?: string | null
          nurse_notified_by?: string | null
          organization_id?: string
          physician_notified?: boolean
          physician_notified_at?: string | null
          physician_response?: string | null
          reported_at?: string
          reported_by?: string
          resident_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          severity?: string
          shift?: Database["public"]["Enums"]["shift_type"]
        }
        Relationships: [
          {
            foreignKeyName: "condition_changes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condition_changes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "condition_changes_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_date: string
          alert_type: Database["public"]["Enums"]["contract_alert_type"]
          contract_id: string
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          organization_id: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["contract_alert_status"]
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_date: string
          alert_type: Database["public"]["Enums"]["contract_alert_type"]
          contract_id: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          organization_id: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["contract_alert_status"]
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_date?: string
          alert_type?: Database["public"]["Enums"]["contract_alert_type"]
          contract_id?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          organization_id?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["contract_alert_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_alerts_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_terms: {
        Row: {
          contract_id: string
          created_at: string
          deleted_at: string | null
          id: string
          insurance_requirements: string | null
          notes: string | null
          organization_id: string
          price_escalation_percent: number | null
          sla_response_hours: number | null
          updated_at: string
        }
        Insert: {
          contract_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          insurance_requirements?: string | null
          notes?: string | null
          organization_id: string
          price_escalation_percent?: number | null
          sla_response_hours?: number | null
          updated_at?: string
        }
        Update: {
          contract_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          insurance_requirements?: string | null
          notes?: string | null
          organization_id?: string
          price_escalation_percent?: number | null
          sla_response_hours?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_terms_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_terms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          auto_renew: boolean
          contract_type: Database["public"]["Enums"]["contract_type"]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          document_storage_path: string | null
          effective_date: string
          expiration_date: string | null
          id: string
          organization_id: string
          payment_terms: string | null
          termination_notice_days: number | null
          title: string
          total_value_cents: number | null
          updated_at: string
          updated_by: string | null
          vendor_id: string
        }
        Insert: {
          auto_renew?: boolean
          contract_type?: Database["public"]["Enums"]["contract_type"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_storage_path?: string | null
          effective_date: string
          expiration_date?: string | null
          id?: string
          organization_id: string
          payment_terms?: string | null
          termination_notice_days?: number | null
          title: string
          total_value_cents?: number | null
          updated_at?: string
          updated_by?: string | null
          vendor_id: string
        }
        Update: {
          auto_renew?: boolean
          contract_type?: Database["public"]["Enums"]["contract_type"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_storage_path?: string | null
          effective_date?: string
          expiration_date?: string | null
          id?: string
          organization_id?: string
          payment_terms?: string | null
          termination_notice_days?: number | null
          title?: string
          total_value_cents?: number | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      controlled_substance_count_variance_events: {
        Row: {
          controlled_substance_count_id: string
          created_at: string
          deleted_at: string | null
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          supervisor_notified_at: string | null
          variance_amount: number
          witness_staff_id: string | null
        }
        Insert: {
          controlled_substance_count_id: string
          created_at?: string
          deleted_at?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          supervisor_notified_at?: string | null
          variance_amount: number
          witness_staff_id?: string | null
        }
        Update: {
          controlled_substance_count_id?: string
          created_at?: string
          deleted_at?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          supervisor_notified_at?: string | null
          variance_amount?: number
          witness_staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "controlled_substance_count_va_controlled_substance_count_i_fkey"
            columns: ["controlled_substance_count_id"]
            isOneToOne: false
            referencedRelation: "controlled_substance_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "controlled_substance_count_variance_event_witness_staff_id_fkey"
            columns: ["witness_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "controlled_substance_count_variance_events_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "controlled_substance_count_variance_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      controlled_substance_counts: {
        Row: {
          actual_count: number
          count_date: string
          count_type: string
          created_at: string
          deleted_at: string | null
          discrepancy: number
          discrepancy_resolved: boolean | null
          expected_count: number
          facility_id: string
          id: string
          incoming_signed_at: string | null
          incoming_staff_id: string | null
          notes: string | null
          organization_id: string
          outgoing_signed_at: string
          outgoing_staff_id: string
          resident_medication_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          shift: Database["public"]["Enums"]["shift_type"]
        }
        Insert: {
          actual_count: number
          count_date: string
          count_type?: string
          created_at?: string
          deleted_at?: string | null
          discrepancy?: number
          discrepancy_resolved?: boolean | null
          expected_count: number
          facility_id: string
          id?: string
          incoming_signed_at?: string | null
          incoming_staff_id?: string | null
          notes?: string | null
          organization_id: string
          outgoing_signed_at?: string
          outgoing_staff_id: string
          resident_medication_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shift: Database["public"]["Enums"]["shift_type"]
        }
        Update: {
          actual_count?: number
          count_date?: string
          count_type?: string
          created_at?: string
          deleted_at?: string | null
          discrepancy?: number
          discrepancy_resolved?: boolean | null
          expected_count?: number
          facility_id?: string
          id?: string
          incoming_signed_at?: string | null
          incoming_staff_id?: string | null
          notes?: string | null
          organization_id?: string
          outgoing_signed_at?: string
          outgoing_staff_id?: string
          resident_medication_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          shift?: Database["public"]["Enums"]["shift_type"]
        }
        Relationships: [
          {
            foreignKeyName: "controlled_substance_counts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "controlled_substance_counts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "controlled_substance_counts_resident_medication_id_fkey"
            columns: ["resident_medication_id"]
            isOneToOne: false
            referencedRelation: "resident_medications"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_logs: {
        Row: {
          behavior_notes: string | null
          blood_pressure_diastolic: number | null
          blood_pressure_systolic: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          general_notes: string | null
          id: string
          log_date: string
          logged_by: string
          mood: string | null
          organization_id: string
          oxygen_saturation: number | null
          pulse: number | null
          resident_id: string
          respiration: number | null
          shift: Database["public"]["Enums"]["shift_type"]
          sleep_notes: string | null
          sleep_quality: string | null
          temperature: number | null
          times_awakened: number | null
          updated_at: string
          updated_by: string | null
          weight_lbs: number | null
        }
        Insert: {
          behavior_notes?: string | null
          blood_pressure_diastolic?: number | null
          blood_pressure_systolic?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          general_notes?: string | null
          id?: string
          log_date: string
          logged_by: string
          mood?: string | null
          organization_id: string
          oxygen_saturation?: number | null
          pulse?: number | null
          resident_id: string
          respiration?: number | null
          shift: Database["public"]["Enums"]["shift_type"]
          sleep_notes?: string | null
          sleep_quality?: string | null
          temperature?: number | null
          times_awakened?: number | null
          updated_at?: string
          updated_by?: string | null
          weight_lbs?: number | null
        }
        Update: {
          behavior_notes?: string | null
          blood_pressure_diastolic?: number | null
          blood_pressure_systolic?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          general_notes?: string | null
          id?: string
          log_date?: string
          logged_by?: string
          mood?: string | null
          organization_id?: string
          oxygen_saturation?: number | null
          pulse?: number | null
          resident_id?: string
          respiration?: number | null
          shift?: Database["public"]["Enums"]["shift_type"]
          sleep_notes?: string | null
          sleep_quality?: string | null
          temperature?: number | null
          times_awakened?: number | null
          updated_at?: string
          updated_by?: string | null
          weight_lbs?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_logs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_logs_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      diet_orders: {
        Row: {
          allergy_constraints: string[]
          aspiration_notes: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          effective_from: string | null
          effective_to: string | null
          facility_id: string
          id: string
          iddsi_fluid_level: Database["public"]["Enums"]["iddsi_fluid_level"]
          iddsi_food_level: Database["public"]["Enums"]["iddsi_food_level"]
          medication_texture_review_notes: string | null
          organization_id: string
          requires_swallow_eval: boolean
          resident_id: string
          status: Database["public"]["Enums"]["diet_order_status"]
          texture_constraints: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allergy_constraints?: string[]
          aspiration_notes?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          effective_from?: string | null
          effective_to?: string | null
          facility_id: string
          id?: string
          iddsi_fluid_level?: Database["public"]["Enums"]["iddsi_fluid_level"]
          iddsi_food_level?: Database["public"]["Enums"]["iddsi_food_level"]
          medication_texture_review_notes?: string | null
          organization_id: string
          requires_swallow_eval?: boolean
          resident_id: string
          status?: Database["public"]["Enums"]["diet_order_status"]
          texture_constraints?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allergy_constraints?: string[]
          aspiration_notes?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          effective_from?: string | null
          effective_to?: string | null
          facility_id?: string
          id?: string
          iddsi_fluid_level?: Database["public"]["Enums"]["iddsi_fluid_level"]
          iddsi_food_level?: Database["public"]["Enums"]["iddsi_food_level"]
          medication_texture_review_notes?: string | null
          organization_id?: string
          requires_swallow_eval?: boolean
          resident_id?: string
          status?: Database["public"]["Enums"]["diet_order_status"]
          texture_constraints?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "diet_orders_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diet_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diet_orders_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      discharge_med_reconciliation: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          med_snapshot_json: Json | null
          nurse_reconciliation_notes: string | null
          organization_id: string
          pharmacist_notes: string | null
          pharmacist_npi: string | null
          pharmacist_reviewed_at: string | null
          pharmacist_reviewed_by: string | null
          resident_id: string
          status: Database["public"]["Enums"]["discharge_med_reconciliation_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          med_snapshot_json?: Json | null
          nurse_reconciliation_notes?: string | null
          organization_id: string
          pharmacist_notes?: string | null
          pharmacist_npi?: string | null
          pharmacist_reviewed_at?: string | null
          pharmacist_reviewed_by?: string | null
          resident_id: string
          status?: Database["public"]["Enums"]["discharge_med_reconciliation_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          med_snapshot_json?: Json | null
          nurse_reconciliation_notes?: string | null
          organization_id?: string
          pharmacist_notes?: string | null
          pharmacist_npi?: string | null
          pharmacist_reviewed_at?: string | null
          pharmacist_reviewed_by?: string | null
          resident_id?: string
          status?: Database["public"]["Enums"]["discharge_med_reconciliation_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discharge_med_reconciliation_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discharge_med_reconciliation_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discharge_med_reconciliation_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          document_id: string | null
          document_title_snapshot: string | null
          event_type: string
          id: string
          metadata: Json | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          document_id?: string | null
          document_title_snapshot?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          document_id?: string | null
          document_title_snapshot?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "document_audit_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          audience: string
          classification_updated_at: string | null
          classification_updated_by: string | null
          conversion_method: string | null
          created_at: string
          deleted_at: string | null
          id: string
          markdown_text: string | null
          metadata: Json | null
          mime_type: string | null
          raw_text: string | null
          review_due_at: string | null
          review_owner: string | null
          source: string
          source_id: string | null
          source_url: string | null
          status: string
          summary: string | null
          title: string
          updated_at: string
          uploaded_by: string | null
          word_count: number | null
          workspace_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          audience?: string
          classification_updated_at?: string | null
          classification_updated_by?: string | null
          conversion_method?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          markdown_text?: string | null
          metadata?: Json | null
          mime_type?: string | null
          raw_text?: string | null
          review_due_at?: string | null
          review_owner?: string | null
          source?: string
          source_id?: string | null
          source_url?: string | null
          status?: string
          summary?: string | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
          word_count?: number | null
          workspace_id?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          audience?: string
          classification_updated_at?: string | null
          classification_updated_by?: string | null
          conversion_method?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          markdown_text?: string | null
          metadata?: Json | null
          mime_type?: string | null
          raw_text?: string | null
          review_due_at?: string | null
          review_owner?: string | null
          source?: string
          source_id?: string | null
          source_url?: string | null
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
          word_count?: number | null
          workspace_id?: string
        }
        Relationships: []
      }
      driver_credentials: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          license_class: string | null
          license_expires_on: string | null
          license_number: string | null
          medical_card_expires_on: string | null
          notes: string | null
          organization_id: string
          staff_id: string
          status: Database["public"]["Enums"]["driver_credential_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          license_class?: string | null
          license_expires_on?: string | null
          license_number?: string | null
          medical_card_expires_on?: string | null
          notes?: string | null
          organization_id: string
          staff_id: string
          status?: Database["public"]["Enums"]["driver_credential_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          license_class?: string | null
          license_expires_on?: string | null
          license_number?: string | null
          medical_card_expires_on?: string | null
          notes?: string | null
          organization_id?: string
          staff_id?: string
          status?: Database["public"]["Enums"]["driver_credential_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_credentials_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_credentials_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      emar_administration_witnesses: {
        Row: {
          created_at: string
          deleted_at: string | null
          emar_record_id: string
          facility_id: string
          id: string
          organization_id: string
          witness_method: string
          witness_staff_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          emar_record_id: string
          facility_id: string
          id?: string
          organization_id: string
          witness_method?: string
          witness_staff_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          emar_record_id?: string
          facility_id?: string
          id?: string
          organization_id?: string
          witness_method?: string
          witness_staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emar_administration_witnesses_emar_record_id_fkey"
            columns: ["emar_record_id"]
            isOneToOne: false
            referencedRelation: "emar_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emar_administration_witnesses_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emar_administration_witnesses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emar_administration_witnesses_witness_staff_id_fkey"
            columns: ["witness_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      emar_records: {
        Row: {
          actual_time: string | null
          administered_by: string | null
          app_version: string | null
          created_at: string
          created_by: string | null
          daily_log_id: string | null
          deleted_at: string | null
          device_id: string | null
          emar_idempotency_key: string | null
          facility_id: string
          hold_reason: string | null
          id: string
          is_prn: boolean
          not_available_reason: string | null
          notes: string | null
          organization_id: string
          prn_effectiveness_checked: boolean | null
          prn_effectiveness_notes: string | null
          prn_effectiveness_result: string | null
          prn_effectiveness_time: string | null
          prn_reason_given: string | null
          refusal_reason: string | null
          resident_id: string
          resident_medication_id: string
          scheduled_time: string
          status: Database["public"]["Enums"]["emar_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actual_time?: string | null
          administered_by?: string | null
          app_version?: string | null
          created_at?: string
          created_by?: string | null
          daily_log_id?: string | null
          deleted_at?: string | null
          device_id?: string | null
          emar_idempotency_key?: string | null
          facility_id: string
          hold_reason?: string | null
          id?: string
          is_prn?: boolean
          not_available_reason?: string | null
          notes?: string | null
          organization_id: string
          prn_effectiveness_checked?: boolean | null
          prn_effectiveness_notes?: string | null
          prn_effectiveness_result?: string | null
          prn_effectiveness_time?: string | null
          prn_reason_given?: string | null
          refusal_reason?: string | null
          resident_id: string
          resident_medication_id: string
          scheduled_time: string
          status?: Database["public"]["Enums"]["emar_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actual_time?: string | null
          administered_by?: string | null
          app_version?: string | null
          created_at?: string
          created_by?: string | null
          daily_log_id?: string | null
          deleted_at?: string | null
          device_id?: string | null
          emar_idempotency_key?: string | null
          facility_id?: string
          hold_reason?: string | null
          id?: string
          is_prn?: boolean
          not_available_reason?: string | null
          notes?: string | null
          organization_id?: string
          prn_effectiveness_checked?: boolean | null
          prn_effectiveness_notes?: string | null
          prn_effectiveness_result?: string | null
          prn_effectiveness_time?: string | null
          prn_reason_given?: string | null
          refusal_reason?: string | null
          resident_id?: string
          resident_medication_id?: string
          scheduled_time?: string
          status?: Database["public"]["Enums"]["emar_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emar_records_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emar_records_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emar_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emar_records_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emar_records_resident_medication_id_fkey"
            columns: ["resident_medication_id"]
            isOneToOne: false
            referencedRelation: "resident_medications"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          city: string | null
          created_at: string
          created_by: string | null
          dba_name: string | null
          deleted_at: string | null
          entity_type: string | null
          fein: string | null
          id: string
          name: string
          organization_id: string
          state: string | null
          status: Database["public"]["Enums"]["entity_status"]
          updated_at: string
          updated_by: string | null
          years_management: number | null
          years_ownership: number | null
          zip: string | null
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          dba_name?: string | null
          deleted_at?: string | null
          entity_type?: string | null
          fein?: string | null
          id?: string
          name: string
          organization_id: string
          state?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
          updated_by?: string | null
          years_management?: number | null
          years_ownership?: number | null
          zip?: string | null
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          dba_name?: string | null
          deleted_at?: string | null
          entity_type?: string | null
          fein?: string | null
          id?: string
          name?: string
          organization_id?: string
          state?: string | null
          status?: Database["public"]["Enums"]["entity_status"]
          updated_at?: string
          updated_by?: string | null
          years_management?: number | null
          years_ownership?: number | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_gl_settings: {
        Row: {
          accounts_payable_gl_account_id: string | null
          accounts_receivable_id: string | null
          cash_id: string | null
          claims_reserve_gl_account_id: string | null
          created_at: string
          created_by: string | null
          entity_id: string
          id: string
          insurance_expense_gl_account_id: string | null
          organization_id: string
          revenue_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accounts_payable_gl_account_id?: string | null
          accounts_receivable_id?: string | null
          cash_id?: string | null
          claims_reserve_gl_account_id?: string | null
          created_at?: string
          created_by?: string | null
          entity_id: string
          id?: string
          insurance_expense_gl_account_id?: string | null
          organization_id: string
          revenue_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accounts_payable_gl_account_id?: string | null
          accounts_receivable_id?: string | null
          cash_id?: string | null
          claims_reserve_gl_account_id?: string | null
          created_at?: string
          created_by?: string | null
          entity_id?: string
          id?: string
          insurance_expense_gl_account_id?: string | null
          organization_id?: string
          revenue_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_gl_settings_accounts_payable_gl_account_id_fkey"
            columns: ["accounts_payable_gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_gl_settings_accounts_receivable_id_fkey"
            columns: ["accounts_receivable_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_gl_settings_cash_id_fkey"
            columns: ["cash_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_gl_settings_claims_reserve_gl_account_id_fkey"
            columns: ["claims_reserve_gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_gl_settings_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_gl_settings_insurance_expense_gl_account_id_fkey"
            columns: ["insurance_expense_gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_gl_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_gl_settings_revenue_id_fkey"
            columns: ["revenue_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_insurance_allocation_settings: {
        Row: {
          allocation_basis_snapshot: Json
          created_at: string
          deleted_at: string | null
          entity_id: string
          id: string
          organization_id: string
          premium_allocation_method: Database["public"]["Enums"]["premium_allocation_method"]
          updated_at: string
        }
        Insert: {
          allocation_basis_snapshot?: Json
          created_at?: string
          deleted_at?: string | null
          entity_id: string
          id?: string
          organization_id: string
          premium_allocation_method?: Database["public"]["Enums"]["premium_allocation_method"]
          updated_at?: string
        }
        Update: {
          allocation_basis_snapshot?: Json
          created_at?: string
          deleted_at?: string | null
          entity_id?: string
          id?: string
          organization_id?: string
          premium_allocation_method?: Database["public"]["Enums"]["premium_allocation_method"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_insurance_allocation_settings_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: true
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_insurance_allocation_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_actions: {
        Row: {
          alert_id: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          description: string | null
          due_date: string | null
          id: string
          organization_id: string
          owner_user_id: string
          priority: string
          related_link_json: Json | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          alert_id?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          organization_id: string
          owner_user_id: string
          priority?: string
          related_link_json?: Json | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          alert_id?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          organization_id?: string
          owner_user_id?: string
          priority?: string
          related_link_json?: Json | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exec_actions_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "exec_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exec_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_alert_user_state: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          deleted_at: string | null
          dismissed_at: string | null
          exec_alert_id: string
          id: string
          organization_id: string
          snoozed_until: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          deleted_at?: string | null
          dismissed_at?: string | null
          exec_alert_id: string
          id?: string
          organization_id: string
          snoozed_until?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          deleted_at?: string | null
          dismissed_at?: string | null
          exec_alert_id?: string
          id?: string
          organization_id?: string
          snoozed_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exec_alert_user_state_exec_alert_id_fkey"
            columns: ["exec_alert_id"]
            isOneToOne: false
            referencedRelation: "exec_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exec_alert_user_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          body: string | null
          category: string | null
          created_at: string
          current_value_json: Json | null
          deep_link_path: string | null
          deleted_at: string | null
          entity_id: string | null
          facility_id: string | null
          first_triggered_at: string
          id: string
          last_evaluated_at: string
          organization_id: string
          owner_user_id: string | null
          prior_value_json: Json | null
          related_link_json: Json | null
          resolved_at: string | null
          resolved_by: string | null
          score: number | null
          severity: Database["public"]["Enums"]["exec_alert_severity"]
          source_metric_code: string | null
          source_module: Database["public"]["Enums"]["exec_alert_source_module"]
          status: string
          threshold_json: Json | null
          title: string
          updated_at: string
          why_it_matters: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          body?: string | null
          category?: string | null
          created_at?: string
          current_value_json?: Json | null
          deep_link_path?: string | null
          deleted_at?: string | null
          entity_id?: string | null
          facility_id?: string | null
          first_triggered_at?: string
          id?: string
          last_evaluated_at?: string
          organization_id: string
          owner_user_id?: string | null
          prior_value_json?: Json | null
          related_link_json?: Json | null
          resolved_at?: string | null
          resolved_by?: string | null
          score?: number | null
          severity: Database["public"]["Enums"]["exec_alert_severity"]
          source_metric_code?: string | null
          source_module: Database["public"]["Enums"]["exec_alert_source_module"]
          status?: string
          threshold_json?: Json | null
          title: string
          updated_at?: string
          why_it_matters?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          body?: string | null
          category?: string | null
          created_at?: string
          current_value_json?: Json | null
          deep_link_path?: string | null
          deleted_at?: string | null
          entity_id?: string | null
          facility_id?: string | null
          first_triggered_at?: string
          id?: string
          last_evaluated_at?: string
          organization_id?: string
          owner_user_id?: string | null
          prior_value_json?: Json | null
          related_link_json?: Json | null
          resolved_at?: string | null
          resolved_by?: string | null
          score?: number | null
          severity?: Database["public"]["Enums"]["exec_alert_severity"]
          source_metric_code?: string | null
          source_module?: Database["public"]["Enums"]["exec_alert_source_module"]
          status?: string
          threshold_json?: Json | null
          title?: string
          updated_at?: string
          why_it_matters?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exec_alerts_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exec_alerts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exec_alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exec_alerts_source_metric_code_fkey"
            columns: ["source_metric_code"]
            isOneToOne: false
            referencedRelation: "exec_metric_definitions"
            referencedColumns: ["code"]
          },
        ]
      }
      exec_dashboard_configs: {
        Row: {
          created_at: string
          default_date_range: string
          deleted_at: string | null
          id: string
          organization_id: string
          updated_at: string
          user_id: string
          widgets: Json
        }
        Insert: {
          created_at?: string
          default_date_range?: string
          deleted_at?: string | null
          id?: string
          organization_id: string
          updated_at?: string
          user_id: string
          widgets?: Json
        }
        Update: {
          created_at?: string
          default_date_range?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
          widgets?: Json
        }
        Relationships: [
          {
            foreignKeyName: "exec_dashboard_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_kpi_snapshots: {
        Row: {
          computed_at: string
          computed_by: string | null
          deleted_at: string | null
          id: string
          lineage: Json
          metrics: Json
          metrics_version: number
          organization_id: string
          scope_id: string
          scope_type: Database["public"]["Enums"]["exec_snapshot_scope"]
          snapshot_date: string
        }
        Insert: {
          computed_at?: string
          computed_by?: string | null
          deleted_at?: string | null
          id?: string
          lineage?: Json
          metrics?: Json
          metrics_version?: number
          organization_id: string
          scope_id: string
          scope_type: Database["public"]["Enums"]["exec_snapshot_scope"]
          snapshot_date: string
        }
        Update: {
          computed_at?: string
          computed_by?: string | null
          deleted_at?: string | null
          id?: string
          lineage?: Json
          metrics?: Json
          metrics_version?: number
          organization_id?: string
          scope_id?: string
          scope_type?: Database["public"]["Enums"]["exec_snapshot_scope"]
          snapshot_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "exec_kpi_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_metric_definitions: {
        Row: {
          category: string
          code: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          display_format: string
          formula_config_json: Json
          formula_type: string
          id: string
          is_active: boolean
          name: string
          role_visibility_json: Json
          threshold_config_json: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          display_format?: string
          formula_config_json?: Json
          formula_type: string
          id?: string
          is_active?: boolean
          name: string
          role_visibility_json?: Json
          threshold_config_json?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          display_format?: string
          formula_config_json?: Json
          formula_type?: string
          id?: string
          is_active?: boolean
          name?: string
          role_visibility_json?: Json
          threshold_config_json?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      exec_metric_snapshots: {
        Row: {
          comparison_value_numeric: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          entity_id: string | null
          facility_id: string | null
          id: string
          metric_code: string
          metric_value_json: Json | null
          metric_value_numeric: number | null
          organization_id: string
          period_type: string
          snapshot_date: string
          source_version: number
          status_color: string | null
          updated_by: string | null
          variance_numeric: number | null
        }
        Insert: {
          comparison_value_numeric?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id?: string | null
          facility_id?: string | null
          id?: string
          metric_code: string
          metric_value_json?: Json | null
          metric_value_numeric?: number | null
          organization_id: string
          period_type?: string
          snapshot_date: string
          source_version?: number
          status_color?: string | null
          updated_by?: string | null
          variance_numeric?: number | null
        }
        Update: {
          comparison_value_numeric?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id?: string | null
          facility_id?: string | null
          id?: string
          metric_code?: string
          metric_value_json?: Json | null
          metric_value_numeric?: number | null
          organization_id?: string
          period_type?: string
          snapshot_date?: string
          source_version?: number
          status_color?: string | null
          updated_by?: string | null
          variance_numeric?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exec_metric_snapshots_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exec_metric_snapshots_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exec_metric_snapshots_metric_code_fkey"
            columns: ["metric_code"]
            isOneToOne: false
            referencedRelation: "exec_metric_definitions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "exec_metric_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_nlq_sessions: {
        Row: {
          ai_invocation_id: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          intent_json: Json
          organization_id: string
          result_summary: string | null
          status: Database["public"]["Enums"]["exec_nlq_session_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_invocation_id?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          intent_json?: Json
          organization_id: string
          result_summary?: string | null
          status?: Database["public"]["Enums"]["exec_nlq_session_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_invocation_id?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          intent_json?: Json
          organization_id?: string
          result_summary?: string | null
          status?: Database["public"]["Enums"]["exec_nlq_session_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exec_nlq_sessions_ai_invocation_id_fkey"
            columns: ["ai_invocation_id"]
            isOneToOne: false
            referencedRelation: "ai_invocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exec_nlq_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_saved_reports: {
        Row: {
          created_at: string
          created_by: string
          deleted_at: string | null
          id: string
          last_generated_at: string | null
          last_output_storage_path: string | null
          name: string
          organization_id: string
          parameters: Json
          template: Database["public"]["Enums"]["exec_report_template"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          deleted_at?: string | null
          id?: string
          last_generated_at?: string | null
          last_output_storage_path?: string | null
          name: string
          organization_id: string
          parameters?: Json
          template?: Database["public"]["Enums"]["exec_report_template"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          id?: string
          last_generated_at?: string | null
          last_output_storage_path?: string | null
          name?: string
          organization_id?: string
          parameters?: Json
          template?: Database["public"]["Enums"]["exec_report_template"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exec_saved_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exec_scenarios: {
        Row: {
          assumptions: Json
          created_at: string
          created_by: string
          deleted_at: string | null
          description: string | null
          facility_id: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          assumptions?: Json
          created_at?: string
          created_by: string
          deleted_at?: string | null
          description?: string | null
          facility_id?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          assumptions?: Json
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          description?: string | null
          facility_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exec_scenarios_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exec_scenarios_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities: {
        Row: {
          address_line_1: string
          address_line_2: string | null
          administrator_name: string | null
          alf_license_type: string | null
          city: string
          cms_certification_number: string | null
          county: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          email: string | null
          entity_id: string
          facility_ratio_rule_set_id: string | null
          fax: string | null
          id: string
          license_authority: string | null
          license_number: string | null
          license_type: Database["public"]["Enums"]["bed_type"]
          medicaid_provider_id: string | null
          name: string
          organization_id: string
          phone: string | null
          settings: Json
          state: string
          status: Database["public"]["Enums"]["facility_status"]
          timezone: string
          total_licensed_beds: number
          updated_at: string
          updated_by: string | null
          zip: string
        }
        Insert: {
          address_line_1: string
          address_line_2?: string | null
          administrator_name?: string | null
          alf_license_type?: string | null
          city: string
          cms_certification_number?: string | null
          county?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          entity_id: string
          facility_ratio_rule_set_id?: string | null
          fax?: string | null
          id?: string
          license_authority?: string | null
          license_number?: string | null
          license_type?: Database["public"]["Enums"]["bed_type"]
          medicaid_provider_id?: string | null
          name: string
          organization_id: string
          phone?: string | null
          settings?: Json
          state?: string
          status?: Database["public"]["Enums"]["facility_status"]
          timezone?: string
          total_licensed_beds: number
          updated_at?: string
          updated_by?: string | null
          zip: string
        }
        Update: {
          address_line_1?: string
          address_line_2?: string | null
          administrator_name?: string | null
          alf_license_type?: string | null
          city?: string
          cms_certification_number?: string | null
          county?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          entity_id?: string
          facility_ratio_rule_set_id?: string | null
          fax?: string | null
          id?: string
          license_authority?: string | null
          license_number?: string | null
          license_type?: Database["public"]["Enums"]["bed_type"]
          medicaid_provider_id?: string | null
          name?: string
          organization_id?: string
          phone?: string | null
          settings?: Json
          state?: string
          status?: Database["public"]["Enums"]["facility_status"]
          timezone?: string
          total_licensed_beds?: number
          updated_at?: string
          updated_by?: string | null
          zip?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilities_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilities_facility_ratio_rule_set_id_fkey"
            columns: ["facility_ratio_rule_set_id"]
            isOneToOne: false
            referencedRelation: "ratio_rule_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facilities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      family_care_conference_sessions: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          external_room_id: string | null
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          recording_consent: boolean
          recording_consent_at: string | null
          recording_consent_by: string | null
          resident_id: string
          scheduled_end: string | null
          scheduled_start: string
          status: Database["public"]["Enums"]["family_care_conference_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          external_room_id?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          recording_consent?: boolean
          recording_consent_at?: string | null
          recording_consent_by?: string | null
          resident_id: string
          scheduled_end?: string | null
          scheduled_start: string
          status?: Database["public"]["Enums"]["family_care_conference_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          external_room_id?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          recording_consent?: boolean
          recording_consent_at?: string | null
          recording_consent_by?: string | null
          resident_id?: string
          scheduled_end?: string | null
          scheduled_start?: string
          status?: Database["public"]["Enums"]["family_care_conference_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_care_conference_sessions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_care_conference_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_care_conference_sessions_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      family_consent_records: {
        Row: {
          consent_type: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          document_version: string
          facility_id: string
          family_user_id: string
          id: string
          ip_address: unknown
          metadata: Json | null
          organization_id: string
          resident_id: string
          signed_at: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          consent_type: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_version: string
          facility_id: string
          family_user_id: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          organization_id: string
          resident_id: string
          signed_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          consent_type?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_version?: string
          facility_id?: string
          family_user_id?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          organization_id?: string
          resident_id?: string
          signed_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_consent_records_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_consent_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_consent_records_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      family_message_triage_items: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          family_portal_message_id: string
          id: string
          matched_keywords: string[]
          notes: string | null
          organization_id: string
          resident_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          triage_status: Database["public"]["Enums"]["family_message_triage_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          family_portal_message_id: string
          id?: string
          matched_keywords?: string[]
          notes?: string | null
          organization_id: string
          resident_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          triage_status?: Database["public"]["Enums"]["family_message_triage_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          family_portal_message_id?: string
          id?: string
          matched_keywords?: string[]
          notes?: string | null
          organization_id?: string
          resident_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          triage_status?: Database["public"]["Enums"]["family_message_triage_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_message_triage_items_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_message_triage_items_family_portal_message_id_fkey"
            columns: ["family_portal_message_id"]
            isOneToOne: false
            referencedRelation: "family_portal_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_message_triage_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_message_triage_items_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      family_portal_messages: {
        Row: {
          author_kind: Database["public"]["Enums"]["family_message_author"]
          author_user_id: string
          body: string
          created_at: string
          deleted_at: string | null
          facility_id: string
          id: string
          organization_id: string
          resident_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          author_kind: Database["public"]["Enums"]["family_message_author"]
          author_user_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          facility_id: string
          id?: string
          organization_id: string
          resident_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          author_kind?: Database["public"]["Enums"]["family_message_author"]
          author_user_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          resident_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_portal_messages_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_portal_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_portal_messages_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      family_resident_links: {
        Row: {
          can_make_decisions: boolean
          can_view_clinical: boolean
          can_view_financial: boolean
          granted_at: string
          granted_by: string | null
          id: string
          is_emergency_contact: boolean
          is_responsible_party: boolean
          organization_id: string
          relationship: string
          resident_id: string
          revoked_at: string | null
          revoked_by: string | null
          user_id: string
        }
        Insert: {
          can_make_decisions?: boolean
          can_view_clinical?: boolean
          can_view_financial?: boolean
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_emergency_contact?: boolean
          is_responsible_party?: boolean
          organization_id: string
          relationship: string
          resident_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          user_id: string
        }
        Update: {
          can_make_decisions?: boolean
          can_view_clinical?: boolean
          can_view_financial?: boolean
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_emergency_contact?: boolean
          is_responsible_party?: boolean
          organization_id?: string
          relationship?: string
          resident_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_resident_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_frl_resident"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_vehicles: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          insurance_expires_on: string | null
          license_plate: string | null
          make: string | null
          model: string | null
          model_year: number | null
          name: string
          notes: string | null
          organization_id: string
          passenger_capacity: number | null
          registration_expires_on: string | null
          status: Database["public"]["Enums"]["fleet_vehicle_status"]
          updated_at: string
          updated_by: string | null
          vin: string | null
          wheelchair_accessible: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          insurance_expires_on?: string | null
          license_plate?: string | null
          make?: string | null
          model?: string | null
          model_year?: number | null
          name: string
          notes?: string | null
          organization_id: string
          passenger_capacity?: number | null
          registration_expires_on?: string | null
          status?: Database["public"]["Enums"]["fleet_vehicle_status"]
          updated_at?: string
          updated_by?: string | null
          vin?: string | null
          wheelchair_accessible?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          insurance_expires_on?: string | null
          license_plate?: string | null
          make?: string | null
          model?: string | null
          model_year?: number | null
          name?: string
          notes?: string | null
          organization_id?: string
          passenger_capacity?: number | null
          registration_expires_on?: string | null
          status?: Database["public"]["Enums"]["fleet_vehicle_status"]
          updated_at?: string
          updated_by?: string | null
          vin?: string | null
          wheelchair_accessible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fleet_vehicles_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["gl_account_type"]
          code: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          entity_id: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          parent_account_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_type: Database["public"]["Enums"]["gl_account_type"]
          code: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          entity_id: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          parent_account_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_type?: Database["public"]["Enums"]["gl_account_type"]
          code?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          entity_id?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          parent_account_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gl_accounts_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_budget_lines: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          entity_id: string
          gl_account_id: string
          id: string
          notes: string | null
          organization_id: string
          period_start: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id: string
          gl_account_id: string
          id?: string
          notes?: string | null
          organization_id: string
          period_start: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id?: string
          gl_account_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          period_start?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gl_budget_lines_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_budget_lines_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_budget_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_period_closes: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          deleted_at: string | null
          entity_id: string
          id: string
          notes: string | null
          organization_id: string
          period_month: number
          period_year: number
          status: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          deleted_at?: string | null
          entity_id: string
          id?: string
          notes?: string | null
          organization_id: string
          period_month: number
          period_year: number
          status?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          deleted_at?: string | null
          entity_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          period_month?: number
          period_year?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gl_period_closes_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_period_closes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_posting_rules: {
        Row: {
          created_at: string
          credit_gl_account_id: string
          debit_gl_account_id: string
          deleted_at: string | null
          entity_id: string
          event_type: string
          id: string
          is_active: boolean
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          credit_gl_account_id: string
          debit_gl_account_id: string
          deleted_at?: string | null
          entity_id: string
          event_type: string
          id?: string
          is_active?: boolean
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          credit_gl_account_id?: string
          debit_gl_account_id?: string
          deleted_at?: string | null
          entity_id?: string
          event_type?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gl_posting_rules_credit_gl_account_id_fkey"
            columns: ["credit_gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_posting_rules_debit_gl_account_id_fkey"
            columns: ["debit_gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_posting_rules_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_posting_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_followups: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          completion_notes: string | null
          created_at: string
          deleted_at: string | null
          description: string
          due_at: string
          facility_id: string
          id: string
          incident_id: string
          organization_id: string
          overdue_alert_sent: boolean
          resident_id: string | null
          task_type: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          created_at?: string
          deleted_at?: string | null
          description: string
          due_at: string
          facility_id: string
          id?: string
          incident_id: string
          organization_id: string
          overdue_alert_sent?: boolean
          resident_id?: string | null
          task_type: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string
          due_at?: string
          facility_id?: string
          id?: string
          incident_id?: string
          organization_id?: string
          overdue_alert_sent?: boolean
          resident_id?: string | null
          task_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_followups_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_followups_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_followups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_followups_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_photos: {
        Row: {
          created_at: string
          description: string | null
          facility_id: string
          id: string
          incident_id: string
          organization_id: string
          storage_path: string
          taken_at: string
          taken_by: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          facility_id: string
          id?: string
          incident_id: string
          organization_id: string
          storage_path: string
          taken_at?: string
          taken_by: string
        }
        Update: {
          created_at?: string
          description?: string | null
          facility_id?: string
          id?: string
          incident_id?: string
          organization_id?: string
          storage_path?: string
          taken_at?: string
          taken_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_photos_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_photos_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_photos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_rca: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          contributing_factor_tags: string[]
          corrective_actions: string
          created_at: string
          created_by: string | null
          facility_id: string
          id: string
          incident_id: string
          investigation_status: string
          organization_id: string
          preventative_actions: string
          root_cause_narrative: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          contributing_factor_tags?: string[]
          corrective_actions?: string
          created_at?: string
          created_by?: string | null
          facility_id: string
          id?: string
          incident_id: string
          investigation_status?: string
          organization_id: string
          preventative_actions?: string
          root_cause_narrative?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          contributing_factor_tags?: string[]
          corrective_actions?: string
          created_at?: string
          created_by?: string | null
          facility_id?: string
          id?: string
          incident_id?: string
          investigation_status?: string
          organization_id?: string
          preventative_actions?: string
          root_cause_narrative?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_rca_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_rca_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: true
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_rca_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_root_cause_taxonomy: {
        Row: {
          code: string
          id: string
          label: string
          sort_order: number
        }
        Insert: {
          code: string
          id?: string
          label: string
          sort_order?: number
        }
        Update: {
          code?: string
          id?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      incident_root_causes: {
        Row: {
          incident_id: string
          root_cause_id: string
        }
        Insert: {
          incident_id: string
          root_cause_id: string
        }
        Update: {
          incident_id?: string
          root_cause_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_root_causes_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_root_causes_root_cause_id_fkey"
            columns: ["root_cause_id"]
            isOneToOne: false
            referencedRelation: "incident_root_cause_taxonomy"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_sequences: {
        Row: {
          facility_id: string
          last_number: number
          year: number
        }
        Insert: {
          facility_id: string
          last_number?: number
          year: number
        }
        Update: {
          facility_id?: string
          last_number?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "incident_sequences_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          administrator_notified: boolean
          administrator_notified_at: string | null
          ahca_reportable: boolean
          ahca_reported: boolean
          ahca_reported_at: string | null
          care_plan_update_notes: string | null
          care_plan_updated: boolean
          category: Database["public"]["Enums"]["incident_category"]
          contributing_factors: string[] | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string
          discovered_at: string
          elopement_found_at: string | null
          elopement_found_location: string | null
          elopement_last_seen_at: string | null
          elopement_last_seen_location: string | null
          elopement_law_enforcement_called: boolean | null
          elopement_law_enforcement_called_at: string | null
          elopement_outcome: string | null
          facility_id: string
          fall_activity: string | null
          fall_assistive_device_used: boolean | null
          fall_bed_rails: string | null
          fall_call_light_accessible: boolean | null
          fall_footwear: string | null
          fall_type: string | null
          fall_witnessed: boolean | null
          family_notified: boolean
          family_notified_at: string | null
          family_notified_by: string | null
          family_notified_method: string | null
          id: string
          immediate_actions: string
          incident_number: string
          injury_body_location: string | null
          injury_description: string | null
          injury_occurred: boolean
          injury_severity: string | null
          injury_treatment: string | null
          insurance_reportable: boolean
          insurance_reported: boolean
          insurance_reported_at: string | null
          location_description: string
          location_type: string | null
          nurse_notified: boolean
          nurse_notified_at: string | null
          nurse_notified_by: string | null
          occurred_at: string
          organization_id: string
          owner_notified: boolean
          owner_notified_at: string | null
          physician_notified: boolean
          physician_notified_at: string | null
          physician_orders_received: string | null
          regulatory_flags: Json
          reported_by: string
          resident_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          room_id: string | null
          severity: Database["public"]["Enums"]["incident_severity"]
          shift: Database["public"]["Enums"]["shift_type"]
          status: Database["public"]["Enums"]["incident_status"]
          unit_id: string | null
          updated_at: string
          updated_by: string | null
          witness_names: string[] | null
          witness_statements: string[] | null
        }
        Insert: {
          administrator_notified?: boolean
          administrator_notified_at?: string | null
          ahca_reportable?: boolean
          ahca_reported?: boolean
          ahca_reported_at?: string | null
          care_plan_update_notes?: string | null
          care_plan_updated?: boolean
          category: Database["public"]["Enums"]["incident_category"]
          contributing_factors?: string[] | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description: string
          discovered_at?: string
          elopement_found_at?: string | null
          elopement_found_location?: string | null
          elopement_last_seen_at?: string | null
          elopement_last_seen_location?: string | null
          elopement_law_enforcement_called?: boolean | null
          elopement_law_enforcement_called_at?: string | null
          elopement_outcome?: string | null
          facility_id: string
          fall_activity?: string | null
          fall_assistive_device_used?: boolean | null
          fall_bed_rails?: string | null
          fall_call_light_accessible?: boolean | null
          fall_footwear?: string | null
          fall_type?: string | null
          fall_witnessed?: boolean | null
          family_notified?: boolean
          family_notified_at?: string | null
          family_notified_by?: string | null
          family_notified_method?: string | null
          id?: string
          immediate_actions: string
          incident_number: string
          injury_body_location?: string | null
          injury_description?: string | null
          injury_occurred?: boolean
          injury_severity?: string | null
          injury_treatment?: string | null
          insurance_reportable?: boolean
          insurance_reported?: boolean
          insurance_reported_at?: string | null
          location_description: string
          location_type?: string | null
          nurse_notified?: boolean
          nurse_notified_at?: string | null
          nurse_notified_by?: string | null
          occurred_at: string
          organization_id: string
          owner_notified?: boolean
          owner_notified_at?: string | null
          physician_notified?: boolean
          physician_notified_at?: string | null
          physician_orders_received?: string | null
          regulatory_flags?: Json
          reported_by: string
          resident_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          room_id?: string | null
          severity: Database["public"]["Enums"]["incident_severity"]
          shift: Database["public"]["Enums"]["shift_type"]
          status?: Database["public"]["Enums"]["incident_status"]
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
          witness_names?: string[] | null
          witness_statements?: string[] | null
        }
        Update: {
          administrator_notified?: boolean
          administrator_notified_at?: string | null
          ahca_reportable?: boolean
          ahca_reported?: boolean
          ahca_reported_at?: string | null
          care_plan_update_notes?: string | null
          care_plan_updated?: boolean
          category?: Database["public"]["Enums"]["incident_category"]
          contributing_factors?: string[] | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string
          discovered_at?: string
          elopement_found_at?: string | null
          elopement_found_location?: string | null
          elopement_last_seen_at?: string | null
          elopement_last_seen_location?: string | null
          elopement_law_enforcement_called?: boolean | null
          elopement_law_enforcement_called_at?: string | null
          elopement_outcome?: string | null
          facility_id?: string
          fall_activity?: string | null
          fall_assistive_device_used?: boolean | null
          fall_bed_rails?: string | null
          fall_call_light_accessible?: boolean | null
          fall_footwear?: string | null
          fall_type?: string | null
          fall_witnessed?: boolean | null
          family_notified?: boolean
          family_notified_at?: string | null
          family_notified_by?: string | null
          family_notified_method?: string | null
          id?: string
          immediate_actions?: string
          incident_number?: string
          injury_body_location?: string | null
          injury_description?: string | null
          injury_occurred?: boolean
          injury_severity?: string | null
          injury_treatment?: string | null
          insurance_reportable?: boolean
          insurance_reported?: boolean
          insurance_reported_at?: string | null
          location_description?: string
          location_type?: string | null
          nurse_notified?: boolean
          nurse_notified_at?: string | null
          nurse_notified_by?: string | null
          occurred_at?: string
          organization_id?: string
          owner_notified?: boolean
          owner_notified_at?: string | null
          physician_notified?: boolean
          physician_notified_at?: string | null
          physician_orders_received?: string | null
          regulatory_flags?: Json
          reported_by?: string
          resident_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          room_id?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"]
          shift?: Database["public"]["Enums"]["shift_type"]
          status?: Database["public"]["Enums"]["incident_status"]
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
          witness_names?: string[] | null
          witness_statements?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "incidents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      infection_outbreaks: {
        Row: {
          ahca_report_notes: string | null
          ahca_reported: boolean
          ahca_reported_at: string | null
          contained_at: string | null
          created_at: string
          created_by: string | null
          declared_by: string
          deleted_at: string | null
          detected_at: string
          detection_method: string
          facility_id: string
          id: string
          infection_type: string
          initial_case_count: number
          notes: string | null
          organization_id: string
          peak_case_count: number | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          total_cases: number | null
          unit_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ahca_report_notes?: string | null
          ahca_reported?: boolean
          ahca_reported_at?: string | null
          contained_at?: string | null
          created_at?: string
          created_by?: string | null
          declared_by: string
          deleted_at?: string | null
          detected_at?: string
          detection_method?: string
          facility_id: string
          id?: string
          infection_type: string
          initial_case_count?: number
          notes?: string | null
          organization_id: string
          peak_case_count?: number | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          total_cases?: number | null
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ahca_report_notes?: string | null
          ahca_reported?: boolean
          ahca_reported_at?: string | null
          contained_at?: string | null
          created_at?: string
          created_by?: string | null
          declared_by?: string
          deleted_at?: string | null
          detected_at?: string
          detection_method?: string
          facility_id?: string
          id?: string
          infection_type?: string
          initial_case_count?: number
          notes?: string | null
          organization_id?: string
          peak_case_count?: number | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          total_cases?: number | null
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "infection_outbreaks_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infection_outbreaks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infection_outbreaks_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      infection_surveillance: {
        Row: {
          ahca_reportable: boolean
          ahca_reported: boolean
          ahca_reported_at: string | null
          antibiotic_end_date: string | null
          antibiotic_name: string | null
          antibiotic_start_date: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          identified_at: string
          identified_by: string
          infection_type: string
          lab_ordered: boolean
          lab_result: string | null
          lab_type: string | null
          onset_date: string
          organism: string | null
          organization_id: string
          outbreak_id: string | null
          outcome: string | null
          outcome_date: string | null
          outcome_notes: string | null
          physician_notified: boolean
          physician_notified_at: string | null
          resident_id: string
          resolved_date: string | null
          status: string
          symptoms: string[]
          temperature_at_onset: number | null
          treatment_notes: string | null
          treatment_type: string | null
          unit_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ahca_reportable?: boolean
          ahca_reported?: boolean
          ahca_reported_at?: string | null
          antibiotic_end_date?: string | null
          antibiotic_name?: string | null
          antibiotic_start_date?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          identified_at?: string
          identified_by: string
          infection_type: string
          lab_ordered?: boolean
          lab_result?: string | null
          lab_type?: string | null
          onset_date: string
          organism?: string | null
          organization_id: string
          outbreak_id?: string | null
          outcome?: string | null
          outcome_date?: string | null
          outcome_notes?: string | null
          physician_notified?: boolean
          physician_notified_at?: string | null
          resident_id: string
          resolved_date?: string | null
          status?: string
          symptoms: string[]
          temperature_at_onset?: number | null
          treatment_notes?: string | null
          treatment_type?: string | null
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ahca_reportable?: boolean
          ahca_reported?: boolean
          ahca_reported_at?: string | null
          antibiotic_end_date?: string | null
          antibiotic_name?: string | null
          antibiotic_start_date?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          identified_at?: string
          identified_by?: string
          infection_type?: string
          lab_ordered?: boolean
          lab_result?: string | null
          lab_type?: string | null
          onset_date?: string
          organism?: string | null
          organization_id?: string
          outbreak_id?: string | null
          outcome?: string | null
          outcome_date?: string | null
          outcome_notes?: string | null
          physician_notified?: boolean
          physician_notified_at?: string | null
          resident_id?: string
          resolved_date?: string | null
          status?: string
          symptoms?: string[]
          temperature_at_onset?: number | null
          treatment_notes?: string | null
          treatment_type?: string | null
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_infection_outbreak"
            columns: ["outbreak_id"]
            isOneToOne: false
            referencedRelation: "infection_outbreaks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infection_surveillance_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infection_surveillance_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infection_surveillance_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infection_surveillance_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      infection_threshold_profiles: {
        Row: {
          created_at: string
          deleted_at: string | null
          facility_id: string | null
          id: string
          name: string
          organization_id: string
          thresholds_json: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          facility_id?: string | null
          id?: string
          name?: string
          organization_id: string
          thresholds_json?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          facility_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          thresholds_json?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "infection_threshold_profiles_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "infection_threshold_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inservice_log_attendees: {
        Row: {
          id: string
          notes: string | null
          session_id: string
          signed_in: boolean
          staff_id: string
        }
        Insert: {
          id?: string
          notes?: string | null
          session_id: string
          signed_in?: boolean
          staff_id: string
        }
        Update: {
          id?: string
          notes?: string | null
          session_id?: string
          signed_in?: boolean
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inservice_log_attendees_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "inservice_log_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inservice_log_attendees_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      inservice_log_sessions: {
        Row: {
          created_at: string
          created_by: string
          deleted_at: string | null
          facility_id: string
          hours: number
          id: string
          location: string | null
          notes: string | null
          organization_id: string
          session_date: string
          topic: string
          trainer_name: string
          trainer_user_id: string | null
          training_program_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          deleted_at?: string | null
          facility_id: string
          hours: number
          id?: string
          location?: string | null
          notes?: string | null
          organization_id: string
          session_date: string
          topic: string
          trainer_name: string
          trainer_user_id?: string | null
          training_program_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          facility_id?: string
          hours?: number
          id?: string
          location?: string | null
          notes?: string | null
          organization_id?: string
          session_date?: string
          topic?: string
          trainer_name?: string
          trainer_user_id?: string | null
          training_program_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inservice_log_sessions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inservice_log_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inservice_log_sessions_training_program_id_fkey"
            columns: ["training_program_id"]
            isOneToOne: false
            referencedRelation: "training_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_claims: {
        Row: {
          adjuster_name: string | null
          claim_number: string | null
          created_at: string
          created_by: string | null
          date_of_loss: string | null
          deleted_at: string | null
          description: string | null
          entity_id: string
          facility_id: string | null
          id: string
          incident_id: string | null
          insurance_policy_id: string | null
          organization_id: string
          paid_cents: number
          reported_at: string | null
          reserve_cents: number
          status: Database["public"]["Enums"]["insurance_claim_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          adjuster_name?: string | null
          claim_number?: string | null
          created_at?: string
          created_by?: string | null
          date_of_loss?: string | null
          deleted_at?: string | null
          description?: string | null
          entity_id: string
          facility_id?: string | null
          id?: string
          incident_id?: string | null
          insurance_policy_id?: string | null
          organization_id: string
          paid_cents?: number
          reported_at?: string | null
          reserve_cents?: number
          status?: Database["public"]["Enums"]["insurance_claim_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          adjuster_name?: string | null
          claim_number?: string | null
          created_at?: string
          created_by?: string | null
          date_of_loss?: string | null
          deleted_at?: string | null
          description?: string | null
          entity_id?: string
          facility_id?: string | null
          id?: string
          incident_id?: string | null
          insurance_policy_id?: string | null
          organization_id?: string
          paid_cents?: number
          reported_at?: string | null
          reserve_cents?: number
          status?: Database["public"]["Enums"]["insurance_claim_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_claims_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_insurance_policy_id_fkey"
            columns: ["insurance_policy_id"]
            isOneToOne: false
            referencedRelation: "insurance_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_policies: {
        Row: {
          aggregate_limit_cents: number | null
          broker_name: string | null
          carrier_name: string
          created_at: string
          created_by: string | null
          deductible_cents: number | null
          deleted_at: string | null
          document_storage_path: string | null
          effective_date: string
          entity_id: string
          expiration_date: string
          id: string
          notes: string | null
          occurrence_limit_cents: number | null
          organization_id: string
          policy_number: string
          policy_type: Database["public"]["Enums"]["insurance_policy_type"]
          premium_cents: number | null
          premium_period: string | null
          status: Database["public"]["Enums"]["insurance_policy_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          aggregate_limit_cents?: number | null
          broker_name?: string | null
          carrier_name: string
          created_at?: string
          created_by?: string | null
          deductible_cents?: number | null
          deleted_at?: string | null
          document_storage_path?: string | null
          effective_date: string
          entity_id: string
          expiration_date: string
          id?: string
          notes?: string | null
          occurrence_limit_cents?: number | null
          organization_id: string
          policy_number: string
          policy_type: Database["public"]["Enums"]["insurance_policy_type"]
          premium_cents?: number | null
          premium_period?: string | null
          status?: Database["public"]["Enums"]["insurance_policy_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          aggregate_limit_cents?: number | null
          broker_name?: string | null
          carrier_name?: string
          created_at?: string
          created_by?: string | null
          deductible_cents?: number | null
          deleted_at?: string | null
          document_storage_path?: string | null
          effective_date?: string
          entity_id?: string
          expiration_date?: string
          id?: string
          notes?: string | null
          occurrence_limit_cents?: number | null
          organization_id?: string
          policy_number?: string
          policy_type?: Database["public"]["Enums"]["insurance_policy_type"]
          premium_cents?: number | null
          premium_period?: string | null
          status?: Database["public"]["Enums"]["insurance_policy_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_policies_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_renewals: {
        Row: {
          bound_premium_cents: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          entity_id: string
          id: string
          insurance_policy_id: string
          milestone_120_date: string | null
          milestone_30_date: string | null
          milestone_60_date: string | null
          milestone_90_date: string | null
          notes: string | null
          organization_id: string
          quoted_premium_cents: number | null
          renewal_data_package_id: string | null
          status: Database["public"]["Enums"]["insurance_renewal_status"]
          target_effective_date: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bound_premium_cents?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id: string
          id?: string
          insurance_policy_id: string
          milestone_120_date?: string | null
          milestone_30_date?: string | null
          milestone_60_date?: string | null
          milestone_90_date?: string | null
          notes?: string | null
          organization_id: string
          quoted_premium_cents?: number | null
          renewal_data_package_id?: string | null
          status?: Database["public"]["Enums"]["insurance_renewal_status"]
          target_effective_date: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bound_premium_cents?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id?: string
          id?: string
          insurance_policy_id?: string
          milestone_120_date?: string | null
          milestone_30_date?: string | null
          milestone_60_date?: string | null
          milestone_90_date?: string | null
          notes?: string | null
          organization_id?: string
          quoted_premium_cents?: number | null
          renewal_data_package_id?: string | null
          status?: Database["public"]["Enums"]["insurance_renewal_status"]
          target_effective_date?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_renewals_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_renewals_insurance_policy_id_fkey"
            columns: ["insurance_policy_id"]
            isOneToOne: false
            referencedRelation: "insurance_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_renewals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_renewals_renewal_data_package_id_fkey"
            columns: ["renewal_data_package_id"]
            isOneToOne: false
            referencedRelation: "renewal_data_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_inbound_queue: {
        Row: {
          created_at: string
          error_message: string | null
          facility_id: string | null
          id: string
          message_type: string
          organization_id: string
          payload_json: Json
          processed_at: string | null
          source_system: string
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          facility_id?: string | null
          id?: string
          message_type: string
          organization_id: string
          payload_json: Json
          processed_at?: string | null
          source_system: string
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          facility_id?: string | null
          id?: string
          message_type?: string
          organization_id?: string
          payload_json?: Json
          processed_at?: string | null
          source_system?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_inbound_queue_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_inbound_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_generation_profiles: {
        Row: {
          created_at: string
          deleted_at: string | null
          facility_id: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          resident_payer_id: string
          rules_json: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          facility_id: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id: string
          resident_payer_id: string
          rules_json?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          facility_id?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          resident_payer_id?: string
          rules_json?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_generation_profiles_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_generation_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_generation_profiles_resident_payer_id_fkey"
            columns: ["resident_payer_id"]
            isOneToOne: false
            referencedRelation: "resident_payers"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_type: string
          organization_id: string
          prorate_days: number | null
          prorate_total_days: number | null
          quantity: number
          sort_order: number
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_type: string
          organization_id: string
          prorate_days?: number | null
          prorate_total_days?: number | null
          quantity?: number
          sort_order?: number
          total: number
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_type?: string
          organization_id?: string
          prorate_days?: number | null
          prorate_total_days?: number | null
          quantity?: number
          sort_order?: number
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_match_rules: {
        Row: {
          created_at: string
          deleted_at: string | null
          facility_id: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          rules_json: Json
          tolerance_cents: number
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          facility_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          rules_json?: Json
          tolerance_cents?: number
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          facility_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          rules_json?: Json
          tolerance_cents?: number
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_match_rules_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_match_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_match_rules_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_sequences: {
        Row: {
          facility_id: string
          last_number: number
          year_month: string
        }
        Insert: {
          facility_id: string
          last_number?: number
          year_month: string
        }
        Update: {
          facility_id?: string
          last_number?: number
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_sequences_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          adjustments: number
          amount_paid: number
          balance_due: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          due_date: string
          entity_id: string
          facility_id: string
          id: string
          invoice_date: string
          invoice_number: string
          notes: string | null
          organization_id: string
          payer_name: string | null
          payer_type: Database["public"]["Enums"]["payer_type"] | null
          period_end: string
          period_start: string
          resident_id: string
          sent_at: string | null
          sent_method: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax: number
          total: number
          updated_at: string
          updated_by: string | null
          voided_at: string | null
          voided_by: string | null
          voided_reason: string | null
        }
        Insert: {
          adjustments?: number
          amount_paid?: number
          balance_due: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          due_date: string
          entity_id: string
          facility_id: string
          id?: string
          invoice_date: string
          invoice_number: string
          notes?: string | null
          organization_id: string
          payer_name?: string | null
          payer_type?: Database["public"]["Enums"]["payer_type"] | null
          period_end: string
          period_start: string
          resident_id: string
          sent_at?: string | null
          sent_method?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax?: number
          total: number
          updated_at?: string
          updated_by?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_reason?: string | null
        }
        Update: {
          adjustments?: number
          amount_paid?: number
          balance_due?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          due_date?: string
          entity_id?: string
          facility_id?: string
          id?: string
          invoice_date?: string
          invoice_number?: string
          notes?: string | null
          organization_id?: string
          payer_name?: string | null
          payer_type?: Database["public"]["Enums"]["payer_type"] | null
          period_end?: string
          period_start?: string
          resident_id?: string
          sent_at?: string | null
          sent_method?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
          voided_at?: string | null
          voided_by?: string | null
          voided_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          entity_id: string
          entry_date: string
          facility_id: string | null
          gl_period_close_id: string | null
          id: string
          memo: string | null
          organization_id: string
          posted_at: string | null
          posted_by: string | null
          source_id: string | null
          source_type: string | null
          status: Database["public"]["Enums"]["journal_entry_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id: string
          entry_date: string
          facility_id?: string | null
          gl_period_close_id?: string | null
          id?: string
          memo?: string | null
          organization_id: string
          posted_at?: string | null
          posted_by?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["journal_entry_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id?: string
          entry_date?: string
          facility_id?: string | null
          gl_period_close_id?: string | null
          id?: string
          memo?: string | null
          organization_id?: string
          posted_at?: string | null
          posted_by?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["journal_entry_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_gl_period_close_id_fkey"
            columns: ["gl_period_close_id"]
            isOneToOne: false
            referencedRelation: "gl_period_closes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entry_lines: {
        Row: {
          created_at: string
          credit_cents: number
          debit_cents: number
          deleted_at: string | null
          description: string | null
          gl_account_id: string
          id: string
          intercompany_counterparty_entity_id: string | null
          intercompany_marker: string | null
          journal_entry_id: string
          line_number: number
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          credit_cents?: number
          debit_cents?: number
          deleted_at?: string | null
          description?: string | null
          gl_account_id: string
          id?: string
          intercompany_counterparty_entity_id?: string | null
          intercompany_marker?: string | null
          journal_entry_id: string
          line_number: number
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          credit_cents?: number
          debit_cents?: number
          deleted_at?: string | null
          description?: string | null
          gl_account_id?: string
          id?: string
          intercompany_counterparty_entity_id?: string | null
          intercompany_marker?: string | null
          journal_entry_id?: string
          line_number?: number
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_lines_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_intercompany_counterparty_entity_id_fkey"
            columns: ["intercompany_counterparty_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_analytics_events: {
        Row: {
          created_at: string
          document_id: string | null
          event_type: string
          id: string
          metadata: Json | null
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
          workspace_id?: string
        }
        Update: {
          created_at?: string
          document_id?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_analytics_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_job_runs: {
        Row: {
          created_at: string
          error_count: number | null
          finished_at: string | null
          id: string
          job_name: string
          metadata: Json | null
          processed_count: number | null
          started_at: string
          status: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          error_count?: number | null
          finished_at?: string | null
          id?: string
          job_name: string
          metadata?: Json | null
          processed_count?: number | null
          started_at?: string
          status?: string | null
          workspace_id?: string
        }
        Update: {
          created_at?: string
          error_count?: number | null
          finished_at?: string | null
          id?: string
          job_name?: string
          metadata?: Json | null
          processed_count?: number | null
          started_at?: string
          status?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      knowledge_gaps: {
        Row: {
          created_at: string
          frequency: number
          id: string
          last_asked_at: string
          question: string
          question_normalized: string | null
          resolution_document_id: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          trace_id: string | null
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          frequency?: number
          id?: string
          last_asked_at?: string
          question: string
          question_normalized?: string | null
          resolution_document_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          trace_id?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Update: {
          created_at?: string
          frequency?: number
          id?: string
          last_asked_at?: string
          question?: string
          question_normalized?: string | null
          resolution_document_id?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          trace_id?: string | null
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_gaps_resolution_document_id_fkey"
            columns: ["resolution_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      lab_observations: {
        Row: {
          abnormal: boolean
          created_at: string
          deleted_at: string | null
          facility_id: string
          id: string
          lab_name: string | null
          loinc: string | null
          observed_at: string
          organization_id: string
          resident_id: string | null
          result_numeric: number | null
          result_text: string | null
          source_message_id: string | null
          staff_id: string | null
          unit: string | null
        }
        Insert: {
          abnormal?: boolean
          created_at?: string
          deleted_at?: string | null
          facility_id: string
          id?: string
          lab_name?: string | null
          loinc?: string | null
          observed_at?: string
          organization_id: string
          resident_id?: string | null
          result_numeric?: number | null
          result_text?: string | null
          source_message_id?: string | null
          staff_id?: string | null
          unit?: string | null
        }
        Update: {
          abnormal?: boolean
          created_at?: string
          deleted_at?: string | null
          facility_id?: string
          id?: string
          lab_name?: string | null
          loinc?: string | null
          observed_at?: string
          organization_id?: string
          resident_id?: string | null
          result_numeric?: number | null
          result_text?: string | null
          source_message_id?: string | null
          staff_id?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_observations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_observations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_observations_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lab_observations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      loss_runs: {
        Row: {
          created_by: string | null
          deleted_at: string | null
          entity_id: string
          generated_at: string
          id: string
          organization_id: string
          payload: Json
          period_end: string
          period_start: string
          total_claims_count: number
          total_paid_cents: number
          total_reserve_cents: number
        }
        Insert: {
          created_by?: string | null
          deleted_at?: string | null
          entity_id: string
          generated_at?: string
          id?: string
          organization_id: string
          payload?: Json
          period_end: string
          period_start: string
          total_claims_count?: number
          total_paid_cents?: number
          total_reserve_cents?: number
        }
        Update: {
          created_by?: string | null
          deleted_at?: string | null
          entity_id?: string
          generated_at?: string
          id?: string
          organization_id?: string
          payload?: Json
          period_end?: string
          period_start?: string
          total_claims_count?: number
          total_paid_cents?: number
          total_reserve_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "loss_runs_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loss_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_errors: {
        Row: {
          contributing_factors: string[] | null
          corrective_actions: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string
          discovered_by: string
          emar_record_id: string | null
          error_type: string
          facility_id: string
          id: string
          immediate_actions: string
          linked_incident_id: string | null
          occurred_at: string
          organization_id: string
          physician_notified: boolean
          physician_notified_at: string | null
          resident_id: string
          resident_medication_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          root_cause: string | null
          severity: string
          shift: Database["public"]["Enums"]["shift_type"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          contributing_factors?: string[] | null
          corrective_actions?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description: string
          discovered_by: string
          emar_record_id?: string | null
          error_type: string
          facility_id: string
          id?: string
          immediate_actions: string
          linked_incident_id?: string | null
          occurred_at?: string
          organization_id: string
          physician_notified?: boolean
          physician_notified_at?: string | null
          resident_id: string
          resident_medication_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          root_cause?: string | null
          severity?: string
          shift: Database["public"]["Enums"]["shift_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          contributing_factors?: string[] | null
          corrective_actions?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string
          discovered_by?: string
          emar_record_id?: string | null
          error_type?: string
          facility_id?: string
          id?: string
          immediate_actions?: string
          linked_incident_id?: string | null
          occurred_at?: string
          organization_id?: string
          physician_notified?: boolean
          physician_notified_at?: string | null
          resident_id?: string
          resident_medication_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          root_cause?: string | null
          severity?: string
          shift?: Database["public"]["Enums"]["shift_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medication_errors_emar_record_id_fkey"
            columns: ["emar_record_id"]
            isOneToOne: false
            referencedRelation: "emar_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_errors_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_errors_linked_incident_id_fkey"
            columns: ["linked_incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_errors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_errors_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_errors_resident_medication_id_fkey"
            columns: ["resident_medication_id"]
            isOneToOne: false
            referencedRelation: "resident_medications"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_reference: {
        Row: {
          created_at: string
          display_name: string
          id: string
          ndc: string | null
          rxcui: string
          tty: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          ndc?: string | null
          rxcui: string
          tty?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          ndc?: string | null
          rxcui?: string
          tty?: string | null
        }
        Relationships: []
      }
      mileage_logs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          destination: string
          facility_id: string
          id: string
          miles: number
          notes: string | null
          organization_id: string
          origin: string
          payroll_export_id: string | null
          purpose: string
          reimbursement_amount_cents: number
          reimbursement_rate_cents: number
          resident_id: string | null
          round_trip: boolean
          staff_id: string
          transport_request_id: string | null
          trip_date: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          destination: string
          facility_id: string
          id?: string
          miles: number
          notes?: string | null
          organization_id: string
          origin: string
          payroll_export_id?: string | null
          purpose: string
          reimbursement_amount_cents: number
          reimbursement_rate_cents: number
          resident_id?: string | null
          round_trip?: boolean
          staff_id: string
          transport_request_id?: string | null
          trip_date: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          destination?: string
          facility_id?: string
          id?: string
          miles?: number
          notes?: string | null
          organization_id?: string
          origin?: string
          payroll_export_id?: string | null
          purpose?: string
          reimbursement_amount_cents?: number
          reimbursement_rate_cents?: number
          resident_id?: string | null
          round_trip?: boolean
          staff_id?: string
          transport_request_id?: string | null
          trip_date?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mileage_logs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_logs_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_logs_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_logs_transport_request_id_fkey"
            columns: ["transport_request_id"]
            isOneToOne: false
            referencedRelation: "resident_transport_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_routes: {
        Row: {
          channels: string[]
          created_at: string
          deleted_at: string | null
          facility_id: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          severity_min: Database["public"]["Enums"]["incident_severity"]
          staff_role_targets: Database["public"]["Enums"]["staff_role"][] | null
          updated_at: string
        }
        Insert: {
          channels?: string[]
          created_at?: string
          deleted_at?: string | null
          facility_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          severity_min?: Database["public"]["Enums"]["incident_severity"]
          staff_role_targets?:
            | Database["public"]["Enums"]["staff_role"][]
            | null
          updated_at?: string
        }
        Update: {
          channels?: string[]
          created_at?: string
          deleted_at?: string | null
          facility_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          severity_min?: Database["public"]["Enums"]["incident_severity"]
          staff_role_targets?:
            | Database["public"]["Enums"]["staff_role"][]
            | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_routes_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_routes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_subscriptions: {
        Row: {
          created_at: string
          deleted_at: string | null
          endpoint: string
          id: string
          keys_json: Json
          last_used_at: string | null
          organization_id: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          endpoint: string
          id?: string
          keys_json?: Json
          last_used_at?: string | null
          organization_id: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          endpoint?: string
          id?: string
          keys_json?: Json
          last_used_at?: string | null
          organization_id?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      on_call_schedules: {
        Row: {
          created_at: string
          deleted_at: string | null
          facility_id: string
          id: string
          is_primary: boolean
          organization_id: string
          phone_override: string | null
          shift_date: string
          shift_type: Database["public"]["Enums"]["shift_type"]
          staff_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          facility_id: string
          id?: string
          is_primary?: boolean
          organization_id: string
          phone_override?: string | null
          shift_date: string
          shift_type: Database["public"]["Enums"]["shift_type"]
          staff_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          facility_id?: string
          id?: string
          is_primary?: boolean
          organization_id?: string
          phone_override?: string | null
          shift_date?: string
          shift_type?: Database["public"]["Enums"]["shift_type"]
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "on_call_schedules_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "on_call_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "on_call_schedules_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_questions: {
        Row: {
          answer_type: string
          assigned_to: string | null
          category: string | null
          created_at: string
          department: string
          help_text: string | null
          id: string
          importance: string
          options: Json | null
          prompt: string
          required: boolean
          sort_order: number | null
          tier: string
          updated_at: string
        }
        Insert: {
          answer_type: string
          assigned_to?: string | null
          category?: string | null
          created_at?: string
          department: string
          help_text?: string | null
          id: string
          importance: string
          options?: Json | null
          prompt: string
          required?: boolean
          sort_order?: number | null
          tier?: string
          updated_at?: string
        }
        Update: {
          answer_type?: string
          assigned_to?: string | null
          category?: string | null
          created_at?: string
          department?: string
          help_text?: string | null
          id?: string
          importance?: string
          options?: Json | null
          prompt?: string
          required?: boolean
          sort_order?: number | null
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      onboarding_responses: {
        Row: {
          confidence: string
          entered_by_name: string
          entered_by_user_id: string | null
          id: string
          organization_id: string
          question_id: string
          updated_at: string
          value: string
        }
        Insert: {
          confidence?: string
          entered_by_name?: string
          entered_by_user_id?: string | null
          id?: string
          organization_id: string
          question_id: string
          updated_at?: string
          value?: string
        }
        Update: {
          confidence?: string
          entered_by_name?: string
          entered_by_user_id?: string | null
          id?: string
          organization_id?: string
          question_id?: string
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_responses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_responses_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "onboarding_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_transport_settings: {
        Row: {
          created_at: string
          created_by: string | null
          mileage_reimbursement_rate_cents: number
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          mileage_reimbursement_rate_cents?: number
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          mileage_reimbursement_rate_cents?: number
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_transport_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          city: string | null
          created_at: string
          created_by: string | null
          dba_name: string | null
          deleted_at: string | null
          id: string
          name: string
          primary_contact_email: string | null
          primary_contact_name: string | null
          primary_contact_phone: string | null
          settings: Json
          state: string | null
          status: Database["public"]["Enums"]["org_status"]
          timezone: string
          updated_at: string
          updated_by: string | null
          zip: string | null
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          dba_name?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          primary_contact_phone?: string | null
          settings?: Json
          state?: string | null
          status?: Database["public"]["Enums"]["org_status"]
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          zip?: string | null
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          dba_name?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          primary_contact_phone?: string | null
          settings?: Json
          state?: string | null
          status?: Database["public"]["Enums"]["org_status"]
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      outbreak_actions: {
        Row: {
          action_type: string
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          completion_notes: string | null
          created_at: string
          deleted_at: string | null
          facility_id: string
          id: string
          instructions: string | null
          organization_id: string
          outbreak_id: string
          priority: string
          sort_order: number
          status: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          action_type: string
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          created_at?: string
          deleted_at?: string | null
          facility_id: string
          id?: string
          instructions?: string | null
          organization_id: string
          outbreak_id: string
          priority?: string
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          action_type?: string
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_notes?: string | null
          created_at?: string
          deleted_at?: string | null
          facility_id?: string
          id?: string
          instructions?: string | null
          organization_id?: string
          outbreak_id?: string
          priority?: string
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outbreak_actions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbreak_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbreak_actions_outbreak_id_fkey"
            columns: ["outbreak_id"]
            isOneToOne: false
            referencedRelation: "infection_outbreaks"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deposited: boolean
          deposited_by: string | null
          deposited_date: string | null
          entity_id: string
          facility_id: string
          id: string
          invoice_id: string | null
          notes: string | null
          organization_id: string
          payer_name: string | null
          payer_type: Database["public"]["Enums"]["payer_type"] | null
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          reference_number: string | null
          refund_amount: number | null
          refund_date: string | null
          refund_reason: string | null
          refunded: boolean
          resident_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deposited?: boolean
          deposited_by?: string | null
          deposited_date?: string | null
          entity_id: string
          facility_id: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          organization_id: string
          payer_name?: string | null
          payer_type?: Database["public"]["Enums"]["payer_type"] | null
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          reference_number?: string | null
          refund_amount?: number | null
          refund_date?: string | null
          refund_reason?: string | null
          refunded?: boolean
          resident_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deposited?: boolean
          deposited_by?: string | null
          deposited_date?: string | null
          entity_id?: string
          facility_id?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          organization_id?: string
          payer_name?: string | null
          payer_type?: Database["public"]["Enums"]["payer_type"] | null
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          reference_number?: string | null
          refund_amount?: number | null
          refund_date?: string | null
          refund_reason?: string | null
          refunded?: boolean
          resident_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_export_batches: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          period_end: string
          period_start: string
          provider: string
          status: Database["public"]["Enums"]["payroll_export_batch_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          period_end: string
          period_start: string
          provider?: string
          status?: Database["public"]["Enums"]["payroll_export_batch_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          period_end?: string
          period_start?: string
          provider?: string
          status?: Database["public"]["Enums"]["payroll_export_batch_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_export_batches_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_export_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_export_lines: {
        Row: {
          amount_cents: number | null
          batch_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          idempotency_key: string
          line_kind: string
          organization_id: string
          payload: Json
          staff_id: string
          time_record_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_cents?: number | null
          batch_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          idempotency_key: string
          line_kind: string
          organization_id: string
          payload?: Json
          staff_id: string
          time_record_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_cents?: number | null
          batch_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          idempotency_key?: string
          line_kind?: string
          organization_id?: string
          payload?: Json
          staff_id?: string
          time_record_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_export_lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "payroll_export_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_export_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_export_lines_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_export_lines_time_record_id_fkey"
            columns: ["time_record_id"]
            isOneToOne: false
            referencedRelation: "time_records"
            referencedColumns: ["id"]
          },
        ]
      }
      pbj_export_batches: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          error_message: string | null
          facility_id: string
          id: string
          organization_id: string
          period_end: string
          period_start: string
          row_count: number | null
          status: Database["public"]["Enums"]["pbj_export_batch_status"]
          storage_path: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          error_message?: string | null
          facility_id: string
          id?: string
          organization_id: string
          period_end: string
          period_start: string
          row_count?: number | null
          status?: Database["public"]["Enums"]["pbj_export_batch_status"]
          storage_path?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          error_message?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          row_count?: number | null
          status?: Database["public"]["Enums"]["pbj_export_batch_status"]
          storage_path?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pbj_export_batches_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pbj_export_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plans_of_correction: {
        Row: {
          accepted_at: string | null
          completion_target_date: string
          corrective_action: string
          created_at: string
          created_by: string | null
          deficiency_id: string
          deleted_at: string | null
          evidence_description: string | null
          evidence_document_ids: string[] | null
          facility_id: string
          id: string
          monitoring_frequency: string | null
          monitoring_plan: string | null
          organization_id: string
          policy_changes: string | null
          responsible_party: string
          reviewer_notes: string | null
          status: string
          submission_due_date: string
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          accepted_at?: string | null
          completion_target_date: string
          corrective_action: string
          created_at?: string
          created_by?: string | null
          deficiency_id: string
          deleted_at?: string | null
          evidence_description?: string | null
          evidence_document_ids?: string[] | null
          facility_id: string
          id?: string
          monitoring_frequency?: string | null
          monitoring_plan?: string | null
          organization_id: string
          policy_changes?: string | null
          responsible_party: string
          reviewer_notes?: string | null
          status?: string
          submission_due_date: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          accepted_at?: string | null
          completion_target_date?: string
          corrective_action?: string
          created_at?: string
          created_by?: string | null
          deficiency_id?: string
          deleted_at?: string | null
          evidence_description?: string | null
          evidence_document_ids?: string[] | null
          facility_id?: string
          id?: string
          monitoring_frequency?: string | null
          monitoring_plan?: string | null
          organization_id?: string
          policy_changes?: string | null
          responsible_party?: string
          reviewer_notes?: string | null
          status?: string
          submission_due_date?: string
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plans_of_correction_deficiency_id_fkey"
            columns: ["deficiency_id"]
            isOneToOne: false
            referencedRelation: "survey_deficiencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_of_correction_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plans_of_correction_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      po_line_items: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          line_number: number
          line_total_cents: number
          organization_id: string
          purchase_order_id: string
          quantity: number
          received_quantity: number
          unit_cost_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description: string
          id?: string
          line_number: number
          line_total_cents?: number
          organization_id: string
          purchase_order_id: string
          quantity?: number
          received_quantity?: number
          unit_cost_cents?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          line_number?: number
          line_total_cents?: number
          organization_id?: string
          purchase_order_id?: string
          quantity?: number
          received_quantity?: number
          unit_cost_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "po_line_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_line_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_acknowledgments: {
        Row: {
          acknowledged_at: string
          created_at: string
          facility_id: string
          id: string
          organization_id: string
          policy_document_id: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string
          created_at?: string
          facility_id: string
          id?: string
          organization_id: string
          policy_document_id: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string
          created_at?: string
          facility_id?: string
          id?: string
          organization_id?: string
          policy_document_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "policy_acknowledgments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_acknowledgments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_acknowledgments_policy_document_id_fkey"
            columns: ["policy_document_id"]
            isOneToOne: false
            referencedRelation: "policy_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_documents: {
        Row: {
          acknowledgment_due_days: number
          ai_generated: boolean
          approved_at: string | null
          approved_by: string | null
          category: string
          content: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          organization_id: string
          previous_version_id: string | null
          published_at: string | null
          published_by: string | null
          requires_acknowledgment: boolean
          status: string
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          acknowledgment_due_days?: number
          ai_generated?: boolean
          approved_at?: string | null
          approved_by?: string | null
          category: string
          content: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          organization_id: string
          previous_version_id?: string | null
          published_at?: string | null
          published_by?: string | null
          requires_acknowledgment?: boolean
          status?: string
          title: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          acknowledgment_due_days?: number
          ai_generated?: boolean
          approved_at?: string | null
          approved_by?: string | null
          category?: string
          content?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          previous_version_id?: string | null
          published_at?: string | null
          published_by?: string | null
          requires_acknowledgment?: boolean
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "policy_documents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_documents_previous_version_id_fkey"
            columns: ["previous_version_id"]
            isOneToOne: false
            referencedRelation: "policy_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      premium_allocations: {
        Row: {
          allocated_premium_cents: number
          allocation_method: string
          allocation_percent: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          insurance_policy_id: string
          organization_id: string
          period_end: string
          period_start: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allocated_premium_cents?: number
          allocation_method?: string
          allocation_percent?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          insurance_policy_id: string
          organization_id: string
          period_end: string
          period_start: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allocated_premium_cents?: number
          allocation_method?: string
          allocation_percent?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          insurance_policy_id?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "premium_allocations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "premium_allocations_insurance_policy_id_fkey"
            columns: ["insurance_policy_id"]
            isOneToOne: false
            referencedRelation: "insurance_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "premium_allocations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          expected_date: string | null
          facility_id: string
          id: string
          notes: string | null
          order_date: string
          organization_id: string
          po_number: string
          status: Database["public"]["Enums"]["po_status"]
          total_cents: number
          updated_at: string
          updated_by: string | null
          vendor_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          expected_date?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          order_date: string
          organization_id: string
          po_number: string
          status?: Database["public"]["Enums"]["po_status"]
          total_cents?: number
          updated_at?: string
          updated_by?: string | null
          vendor_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          expected_date?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          order_date?: string
          organization_id?: string
          po_number?: string
          status?: Database["public"]["Enums"]["po_status"]
          total_cents?: number
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_measure_results: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          period_end: string
          period_start: string
          quality_measure_id: string
          source: string
          updated_at: string
          updated_by: string | null
          value_numeric: number | null
          value_text: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          period_end: string
          period_start: string
          quality_measure_id: string
          source?: string
          updated_at?: string
          updated_by?: string | null
          value_numeric?: number | null
          value_text?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          period_end?: string
          period_start?: string
          quality_measure_id?: string
          source?: string
          updated_at?: string
          updated_by?: string | null
          value_numeric?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_measure_results_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_measure_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_measure_results_quality_measure_id_fkey"
            columns: ["quality_measure_id"]
            isOneToOne: false
            referencedRelation: "quality_measures"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_measures: {
        Row: {
          cms_tag: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          domain: string | null
          id: string
          is_active: boolean
          measure_key: string
          name: string
          organization_id: string
          unit: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cms_tag?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          domain?: string | null
          id?: string
          is_active?: boolean
          measure_key: string
          name: string
          organization_id: string
          unit?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cms_tag?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          domain?: string | null
          id?: string
          is_active?: boolean
          measure_key?: string
          name?: string
          organization_id?: string
          unit?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_measures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_schedules: {
        Row: {
          base_rate_private: number
          base_rate_semi_private: number | null
          bed_hold_daily_rate: number | null
          care_surcharge_level_1: number
          care_surcharge_level_2: number
          care_surcharge_level_3: number
          community_fee: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          effective_date: string
          end_date: string | null
          facility_id: string
          id: string
          name: string
          notes: string | null
          organization_id: string
          pet_fee: number | null
          respite_daily_rate: number | null
          second_occupant_fee: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          base_rate_private: number
          base_rate_semi_private?: number | null
          bed_hold_daily_rate?: number | null
          care_surcharge_level_1?: number
          care_surcharge_level_2: number
          care_surcharge_level_3: number
          community_fee?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          effective_date: string
          end_date?: string | null
          facility_id: string
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          pet_fee?: number | null
          respite_daily_rate?: number | null
          second_occupant_fee?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          base_rate_private?: number
          base_rate_semi_private?: number | null
          bed_hold_daily_rate?: number | null
          care_surcharge_level_1?: number
          care_surcharge_level_2?: number
          care_surcharge_level_3?: number
          community_fee?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          effective_date?: string
          end_date?: string | null
          facility_id?: string
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          pet_fee?: number | null
          respite_daily_rate?: number | null
          second_occupant_fee?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rate_schedules_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rate_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ratio_rule_sets: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          name: string
          organization_id: string
          rules_json: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          name: string
          organization_id: string
          rules_json?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          name?: string
          organization_id?: string
          rules_json?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratio_rule_sets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_hl7_inbound: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          linked_referral_lead_id: string | null
          message_control_id: string | null
          organization_id: string
          parse_error: string | null
          raw_message: string
          status: Database["public"]["Enums"]["referral_hl7_inbound_status"]
          trigger_event: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          linked_referral_lead_id?: string | null
          message_control_id?: string | null
          organization_id: string
          parse_error?: string | null
          raw_message: string
          status?: Database["public"]["Enums"]["referral_hl7_inbound_status"]
          trigger_event?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          linked_referral_lead_id?: string | null
          message_control_id?: string | null
          organization_id?: string
          parse_error?: string | null
          raw_message?: string
          status?: Database["public"]["Enums"]["referral_hl7_inbound_status"]
          trigger_event?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_hl7_inbound_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_hl7_inbound_linked_referral_lead_id_fkey"
            columns: ["linked_referral_lead_id"]
            isOneToOne: false
            referencedRelation: "referral_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_hl7_inbound_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_leads: {
        Row: {
          converted_at: string | null
          converted_resident_id: string | null
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          deleted_at: string | null
          email: string | null
          external_reference: string | null
          facility_id: string
          first_name: string
          id: string
          last_name: string
          merged_at: string | null
          merged_by: string | null
          merged_into_lead_id: string | null
          notes: string | null
          organization_id: string
          phone: string | null
          pii_access_tier: Database["public"]["Enums"]["pii_access_tier"]
          preferred_name: string | null
          referral_source_id: string | null
          status: Database["public"]["Enums"]["referral_lead_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          converted_at?: string | null
          converted_resident_id?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          external_reference?: string | null
          facility_id: string
          first_name: string
          id?: string
          last_name: string
          merged_at?: string | null
          merged_by?: string | null
          merged_into_lead_id?: string | null
          notes?: string | null
          organization_id: string
          phone?: string | null
          pii_access_tier?: Database["public"]["Enums"]["pii_access_tier"]
          preferred_name?: string | null
          referral_source_id?: string | null
          status?: Database["public"]["Enums"]["referral_lead_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          converted_at?: string | null
          converted_resident_id?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          external_reference?: string | null
          facility_id?: string
          first_name?: string
          id?: string
          last_name?: string
          merged_at?: string | null
          merged_by?: string | null
          merged_into_lead_id?: string | null
          notes?: string | null
          organization_id?: string
          phone?: string | null
          pii_access_tier?: Database["public"]["Enums"]["pii_access_tier"]
          preferred_name?: string | null
          referral_source_id?: string | null
          status?: Database["public"]["Enums"]["referral_lead_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_leads_converted_resident_id_fkey"
            columns: ["converted_resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_leads_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_leads_merged_into_lead_id_fkey"
            columns: ["merged_into_lead_id"]
            isOneToOne: false
            referencedRelation: "referral_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_leads_referral_source_id_fkey"
            columns: ["referral_source_id"]
            isOneToOne: false
            referencedRelation: "referral_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_sources: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          external_id: string | null
          facility_id: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          source_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          external_id?: string | null
          facility_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          source_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          external_id?: string | null
          facility_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          source_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_sources_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      regulatory_reporting_obligations: {
        Row: {
          authority: string | null
          authority_case_number: string | null
          created_at: string
          deleted_at: string | null
          due_at: string
          facility_id: string
          id: string
          incident_id: string
          jurisdiction: string
          notes: string | null
          organization_id: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          authority?: string | null
          authority_case_number?: string | null
          created_at?: string
          deleted_at?: string | null
          due_at: string
          facility_id: string
          id?: string
          incident_id: string
          jurisdiction?: string
          notes?: string | null
          organization_id: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          authority?: string | null
          authority_case_number?: string | null
          created_at?: string
          deleted_at?: string | null
          due_at?: string
          facility_id?: string
          id?: string
          incident_id?: string
          jurisdiction?: string
          notes?: string | null
          organization_id?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_reporting_obligations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_reporting_obligations_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "regulatory_reporting_obligations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      regulatory_rules: {
        Row: {
          body_excerpt: string | null
          citation: string
          created_at: string
          jurisdiction: string
          title: string
        }
        Insert: {
          body_excerpt?: string | null
          citation: string
          created_at?: string
          jurisdiction?: string
          title: string
        }
        Update: {
          body_excerpt?: string | null
          citation?: string
          created_at?: string
          jurisdiction?: string
          title?: string
        }
        Relationships: []
      }
      renewal_data_packages: {
        Row: {
          ai_narrative_draft: string | null
          ai_narrative_generated_at: string | null
          created_by: string | null
          deleted_at: string | null
          entity_id: string
          generated_at: string
          id: string
          insurance_policy_id: string
          narrative_published_at: string | null
          narrative_published_by: string | null
          narrative_reviewed_at: string | null
          narrative_reviewed_by: string | null
          organization_id: string
          payload: Json
          period_end: string
          period_start: string
        }
        Insert: {
          ai_narrative_draft?: string | null
          ai_narrative_generated_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          entity_id: string
          generated_at?: string
          id?: string
          insurance_policy_id: string
          narrative_published_at?: string | null
          narrative_published_by?: string | null
          narrative_reviewed_at?: string | null
          narrative_reviewed_by?: string | null
          organization_id: string
          payload?: Json
          period_end: string
          period_start: string
        }
        Update: {
          ai_narrative_draft?: string | null
          ai_narrative_generated_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          entity_id?: string
          generated_at?: string
          id?: string
          insurance_policy_id?: string
          narrative_published_at?: string | null
          narrative_published_by?: string | null
          narrative_reviewed_at?: string | null
          narrative_reviewed_by?: string | null
          organization_id?: string
          payload?: Json
          period_end?: string
          period_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "renewal_data_packages_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewal_data_packages_insurance_policy_id_fkey"
            columns: ["insurance_policy_id"]
            isOneToOne: false
            referencedRelation: "insurance_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "renewal_data_packages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      report_benchmarks: {
        Row: {
          benchmark_type: string
          created_at: string
          deleted_at: string | null
          effective_from: string
          effective_to: string | null
          id: string
          metric_key: string
          organization_id: string
          scope_id: string | null
          scope_type: Database["public"]["Enums"]["exec_snapshot_scope"]
          updated_at: string
          value_definition_json: Json
        }
        Insert: {
          benchmark_type: string
          created_at?: string
          deleted_at?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          metric_key: string
          organization_id: string
          scope_id?: string | null
          scope_type: Database["public"]["Enums"]["exec_snapshot_scope"]
          updated_at?: string
          value_definition_json?: Json
        }
        Update: {
          benchmark_type?: string
          created_at?: string
          deleted_at?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          metric_key?: string
          organization_id?: string
          scope_id?: string | null
          scope_type?: Database["public"]["Enums"]["exec_snapshot_scope"]
          updated_at?: string
          value_definition_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "report_benchmarks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      report_exports: {
        Row: {
          created_at: string
          delivered_to_json: Json
          expires_at: string | null
          export_format: Database["public"]["Enums"]["report_export_format"]
          file_name: string | null
          id: string
          organization_id: string
          report_run_id: string
          storage_path: string | null
        }
        Insert: {
          created_at?: string
          delivered_to_json?: Json
          expires_at?: string | null
          export_format: Database["public"]["Enums"]["report_export_format"]
          file_name?: string | null
          id?: string
          organization_id: string
          report_run_id: string
          storage_path?: string | null
        }
        Update: {
          created_at?: string
          delivered_to_json?: Json
          expires_at?: string | null
          export_format?: Database["public"]["Enums"]["report_export_format"]
          file_name?: string | null
          id?: string
          organization_id?: string
          report_run_id?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_exports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_exports_report_run_id_fkey"
            columns: ["report_run_id"]
            isOneToOne: false
            referencedRelation: "report_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      report_nlq_mappings: {
        Row: {
          active: boolean
          confidence_threshold: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          intent_json: Json
          organization_id: string
          prompt_pattern: string
          template_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          confidence_threshold?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          intent_json?: Json
          organization_id: string
          prompt_pattern: string
          template_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          confidence_threshold?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          intent_json?: Json
          organization_id?: string
          prompt_pattern?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_nlq_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_nlq_mappings_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      report_pack_items: {
        Row: {
          created_at: string
          deleted_at: string | null
          display_order: number
          id: string
          optional_title_override: string | null
          organization_id: string
          pack_id: string
          page_break_before: boolean
          source_id: string
          source_type: Database["public"]["Enums"]["report_source_type"]
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          id?: string
          optional_title_override?: string | null
          organization_id: string
          pack_id: string
          page_break_before?: boolean
          source_id: string
          source_type: Database["public"]["Enums"]["report_source_type"]
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          id?: string
          optional_title_override?: string | null
          organization_id?: string
          pack_id?: string
          page_break_before?: boolean
          source_id?: string
          source_type?: Database["public"]["Enums"]["report_source_type"]
        }
        Relationships: [
          {
            foreignKeyName: "report_pack_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_pack_items_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "report_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      report_packs: {
        Row: {
          active: boolean
          category: string
          created_at: string
          created_by: string
          deleted_at: string | null
          description: string | null
          entity_id: string | null
          facility_id: string | null
          id: string
          locked_definition: boolean
          name: string
          notes: string | null
          official_pack: boolean
          organization_id: string
          owner_scope: Database["public"]["Enums"]["report_sharing_scope"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          description?: string | null
          entity_id?: string | null
          facility_id?: string | null
          id?: string
          locked_definition?: boolean
          name: string
          notes?: string | null
          official_pack?: boolean
          organization_id: string
          owner_scope?: Database["public"]["Enums"]["report_sharing_scope"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          description?: string | null
          entity_id?: string | null
          facility_id?: string | null
          id?: string
          locked_definition?: boolean
          name?: string
          notes?: string | null
          official_pack?: boolean
          organization_id?: string
          owner_scope?: Database["public"]["Enums"]["report_sharing_scope"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_packs_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_packs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_packs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      report_permissions: {
        Row: {
          can_edit: boolean
          can_export: boolean
          can_run: boolean
          can_schedule: boolean
          can_view: boolean
          created_at: string
          deleted_at: string | null
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          template_id: string
          updated_at: string
        }
        Insert: {
          can_edit?: boolean
          can_export?: boolean
          can_run?: boolean
          can_schedule?: boolean
          can_view?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          template_id: string
          updated_at?: string
        }
        Update: {
          can_edit?: boolean
          can_export?: boolean
          can_run?: boolean
          can_schedule?: boolean
          can_view?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_permissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_permissions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      report_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_json: Json | null
          filter_snapshot_json: Json
          generated_by_user_id: string | null
          id: string
          organization_id: string
          run_scope_json: Json
          runtime_classification: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["report_source_type"]
          started_at: string
          status: Database["public"]["Enums"]["report_run_status"]
          template_id: string | null
          template_version_id: string | null
          warnings_json: Json
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_json?: Json | null
          filter_snapshot_json?: Json
          generated_by_user_id?: string | null
          id?: string
          organization_id: string
          run_scope_json?: Json
          runtime_classification?: string | null
          source_id: string
          source_type: Database["public"]["Enums"]["report_source_type"]
          started_at?: string
          status?: Database["public"]["Enums"]["report_run_status"]
          template_id?: string | null
          template_version_id?: string | null
          warnings_json?: Json
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_json?: Json | null
          filter_snapshot_json?: Json
          generated_by_user_id?: string | null
          id?: string
          organization_id?: string
          run_scope_json?: Json
          runtime_classification?: string | null
          source_id?: string
          source_type?: Database["public"]["Enums"]["report_source_type"]
          started_at?: string
          status?: Database["public"]["Enums"]["report_run_status"]
          template_id?: string | null
          template_version_id?: string | null
          warnings_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "report_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_runs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_runs_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "report_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      report_saved_views: {
        Row: {
          archived_at: string | null
          created_at: string
          custom_filters_json: Json
          custom_grouping_json: Json
          custom_sort_json: Json
          deleted_at: string | null
          entity_id: string | null
          facility_id: string | null
          id: string
          is_favorite: boolean
          name: string
          organization_id: string
          owner_user_id: string
          pinned_template_version: boolean
          sharing_scope: Database["public"]["Enums"]["report_sharing_scope"]
          template_id: string
          template_version_id: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          custom_filters_json?: Json
          custom_grouping_json?: Json
          custom_sort_json?: Json
          deleted_at?: string | null
          entity_id?: string | null
          facility_id?: string | null
          id?: string
          is_favorite?: boolean
          name: string
          organization_id: string
          owner_user_id: string
          pinned_template_version?: boolean
          sharing_scope?: Database["public"]["Enums"]["report_sharing_scope"]
          template_id: string
          template_version_id: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          custom_filters_json?: Json
          custom_grouping_json?: Json
          custom_sort_json?: Json
          deleted_at?: string | null
          entity_id?: string | null
          facility_id?: string | null
          id?: string
          is_favorite?: boolean
          name?: string
          organization_id?: string
          owner_user_id?: string
          pinned_template_version?: boolean
          sharing_scope?: Database["public"]["Enums"]["report_sharing_scope"]
          template_id?: string
          template_version_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_saved_views_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_saved_views_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_saved_views_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_saved_views_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_saved_views_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "report_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      report_schedule_recipients: {
        Row: {
          created_at: string
          deleted_at: string | null
          destination: string
          id: string
          organization_id: string
          recipient_email: string | null
          recipient_user_id: string | null
          schedule_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          destination?: string
          id?: string
          organization_id: string
          recipient_email?: string | null
          recipient_user_id?: string | null
          schedule_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          destination?: string
          id?: string
          organization_id?: string
          recipient_email?: string | null
          recipient_user_id?: string | null
          schedule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_schedule_recipients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_schedule_recipients_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "report_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      report_schedules: {
        Row: {
          created_at: string
          created_by: string
          deleted_at: string | null
          entity_id: string | null
          facility_id: string | null
          id: string
          last_error: string | null
          last_run_at: string | null
          next_run_at: string | null
          organization_id: string
          output_format: Database["public"]["Enums"]["report_export_format"]
          recurrence_rule: string
          source_id: string
          source_type: Database["public"]["Enums"]["report_source_type"]
          status: Database["public"]["Enums"]["report_schedule_status"]
          timezone: string
          title_pattern: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          deleted_at?: string | null
          entity_id?: string | null
          facility_id?: string | null
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          next_run_at?: string | null
          organization_id: string
          output_format?: Database["public"]["Enums"]["report_export_format"]
          recurrence_rule: string
          source_id: string
          source_type: Database["public"]["Enums"]["report_source_type"]
          status?: Database["public"]["Enums"]["report_schedule_status"]
          timezone?: string
          title_pattern?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          entity_id?: string | null
          facility_id?: string | null
          id?: string
          last_error?: string | null
          last_run_at?: string | null
          next_run_at?: string | null
          organization_id?: string
          output_format?: Database["public"]["Enums"]["report_export_format"]
          recurrence_rule?: string
          source_id?: string
          source_type?: Database["public"]["Enums"]["report_source_type"]
          status?: Database["public"]["Enums"]["report_schedule_status"]
          timezone?: string
          title_pattern?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_schedules_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_schedules_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      report_template_versions: {
        Row: {
          change_summary: string | null
          created_at: string
          definition_json: Json
          deleted_at: string | null
          id: string
          published_at: string
          published_by: string | null
          status: Database["public"]["Enums"]["report_template_status"]
          template_id: string
          version_number: number
        }
        Insert: {
          change_summary?: string | null
          created_at?: string
          definition_json?: Json
          deleted_at?: string | null
          id?: string
          published_at?: string
          published_by?: string | null
          status?: Database["public"]["Enums"]["report_template_status"]
          template_id: string
          version_number: number
        }
        Update: {
          change_summary?: string | null
          created_at?: string
          definition_json?: Json
          deleted_at?: string | null
          id?: string
          published_at?: string
          published_by?: string | null
          status?: Database["public"]["Enums"]["report_template_status"]
          template_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "report_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      report_templates: {
        Row: {
          benchmark_capable: boolean
          category: string
          clonable: boolean
          created_at: string
          created_by: string | null
          default_pack_membership: string[]
          deleted_at: string | null
          id: string
          intended_roles: Database["public"]["Enums"]["app_role"][]
          locked_definition: boolean
          long_description: string | null
          name: string
          official_template: boolean
          organization_id: string | null
          owner_type: Database["public"]["Enums"]["report_owner_type"]
          owner_user_id: string | null
          short_description: string
          slug: string
          status: Database["public"]["Enums"]["report_template_status"]
          supports_nlq_mapping: boolean
          supports_pack_membership: boolean
          supports_schedule: boolean
          tags: string[]
          updated_at: string
          updated_by: string | null
          use_cases: string[]
        }
        Insert: {
          benchmark_capable?: boolean
          category: string
          clonable?: boolean
          created_at?: string
          created_by?: string | null
          default_pack_membership?: string[]
          deleted_at?: string | null
          id?: string
          intended_roles?: Database["public"]["Enums"]["app_role"][]
          locked_definition?: boolean
          long_description?: string | null
          name: string
          official_template?: boolean
          organization_id?: string | null
          owner_type?: Database["public"]["Enums"]["report_owner_type"]
          owner_user_id?: string | null
          short_description?: string
          slug: string
          status?: Database["public"]["Enums"]["report_template_status"]
          supports_nlq_mapping?: boolean
          supports_pack_membership?: boolean
          supports_schedule?: boolean
          tags?: string[]
          updated_at?: string
          updated_by?: string | null
          use_cases?: string[]
        }
        Update: {
          benchmark_capable?: boolean
          category?: string
          clonable?: boolean
          created_at?: string
          created_by?: string | null
          default_pack_membership?: string[]
          deleted_at?: string | null
          id?: string
          intended_roles?: Database["public"]["Enums"]["app_role"][]
          locked_definition?: boolean
          long_description?: string | null
          name?: string
          official_template?: boolean
          organization_id?: string | null
          owner_type?: Database["public"]["Enums"]["report_owner_type"]
          owner_user_id?: string | null
          short_description?: string
          slug?: string
          status?: Database["public"]["Enums"]["report_template_status"]
          supports_nlq_mapping?: boolean
          supports_pack_membership?: boolean
          supports_schedule?: boolean
          tags?: string[]
          updated_at?: string
          updated_by?: string | null
          use_cases?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "report_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reputation_accounts: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          external_place_id: string | null
          facility_id: string
          id: string
          is_active: boolean
          label: string
          notes: string | null
          organization_id: string
          platform: Database["public"]["Enums"]["reputation_platform"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          external_place_id?: string | null
          facility_id: string
          id?: string
          is_active?: boolean
          label: string
          notes?: string | null
          organization_id: string
          platform?: Database["public"]["Enums"]["reputation_platform"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          external_place_id?: string | null
          facility_id?: string
          id?: string
          is_active?: boolean
          label?: string
          notes?: string | null
          organization_id?: string
          platform?: Database["public"]["Enums"]["reputation_platform"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reputation_accounts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reputation_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reputation_google_oauth_credentials: {
        Row: {
          access_token: string | null
          access_token_expires_at: string | null
          connected_at: string
          connected_by: string | null
          organization_id: string
          refresh_token: string
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          access_token_expires_at?: string | null
          connected_at?: string
          connected_by?: string | null
          organization_id: string
          refresh_token: string
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          access_token_expires_at?: string | null
          connected_at?: string
          connected_by?: string | null
          organization_id?: string
          refresh_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reputation_google_oauth_credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reputation_replies: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          external_review_id: string | null
          facility_id: string
          id: string
          organization_id: string
          posted_by_user_id: string | null
          posted_to_platform_at: string | null
          reply_body: string
          reputation_account_id: string
          review_excerpt: string | null
          status: Database["public"]["Enums"]["reputation_reply_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          external_review_id?: string | null
          facility_id: string
          id?: string
          organization_id: string
          posted_by_user_id?: string | null
          posted_to_platform_at?: string | null
          reply_body: string
          reputation_account_id: string
          review_excerpt?: string | null
          status?: Database["public"]["Enums"]["reputation_reply_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          external_review_id?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          posted_by_user_id?: string | null
          posted_to_platform_at?: string | null
          reply_body?: string
          reputation_account_id?: string
          review_excerpt?: string | null
          status?: Database["public"]["Enums"]["reputation_reply_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reputation_replies_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reputation_replies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reputation_replies_reputation_account_id_fkey"
            columns: ["reputation_account_id"]
            isOneToOne: false
            referencedRelation: "reputation_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_contacts: {
        Row: {
          address: string | null
          contact_type: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          email: string | null
          facility_id: string
          fax: string | null
          id: string
          is_emergency_contact: boolean
          is_healthcare_proxy: boolean
          is_power_of_attorney: boolean
          name: string
          notes: string | null
          notification_preference: string | null
          organization_id: string
          phone: string | null
          phone_alt: string | null
          relationship: string | null
          resident_id: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          contact_type: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          facility_id: string
          fax?: string | null
          id?: string
          is_emergency_contact?: boolean
          is_healthcare_proxy?: boolean
          is_power_of_attorney?: boolean
          name: string
          notes?: string | null
          notification_preference?: string | null
          organization_id: string
          phone?: string | null
          phone_alt?: string | null
          relationship?: string | null
          resident_id: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          contact_type?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          facility_id?: string
          fax?: string | null
          id?: string
          is_emergency_contact?: boolean
          is_healthcare_proxy?: boolean
          is_power_of_attorney?: boolean
          name?: string
          notes?: string | null
          notification_preference?: string | null
          organization_id?: string
          phone?: string | null
          phone_alt?: string | null
          relationship?: string | null
          resident_id?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_contacts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_contacts_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_documents: {
        Row: {
          created_at: string
          deleted_at: string | null
          document_type: string
          expiration_date: string | null
          facility_id: string
          file_size: number | null
          file_type: string | null
          id: string
          notes: string | null
          organization_id: string
          resident_id: string
          storage_path: string
          title: string
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          document_type: string
          expiration_date?: string | null
          facility_id: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          resident_id: string
          storage_path: string
          title: string
          uploaded_at?: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          document_type?: string
          expiration_date?: string | null
          facility_id?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          resident_id?: string
          storage_path?: string
          title?: string
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "resident_documents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_documents_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_medications: {
        Row: {
          controlled_schedule: Database["public"]["Enums"]["controlled_schedule"]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          discontinued_by: string | null
          discontinued_date: string | null
          discontinued_reason: string | null
          end_date: string | null
          facility_id: string
          form: string | null
          frequency: Database["public"]["Enums"]["medication_frequency"]
          frequency_detail: string | null
          generic_name: string | null
          id: string
          indication: string | null
          instructions: string | null
          medication_name: string
          medication_reference_id: string | null
          order_date: string
          order_document_id: string | null
          order_source: string | null
          organization_id: string
          pharmacy_name: string | null
          prescriber_name: string | null
          prescriber_phone: string | null
          prn_effectiveness_check_minutes: number | null
          prn_max_frequency: string | null
          prn_reason: string | null
          resident_id: string
          route: Database["public"]["Enums"]["medication_route"]
          scheduled_times: string[] | null
          start_date: string
          status: Database["public"]["Enums"]["medication_status"]
          strength: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          controlled_schedule?: Database["public"]["Enums"]["controlled_schedule"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discontinued_by?: string | null
          discontinued_date?: string | null
          discontinued_reason?: string | null
          end_date?: string | null
          facility_id: string
          form?: string | null
          frequency: Database["public"]["Enums"]["medication_frequency"]
          frequency_detail?: string | null
          generic_name?: string | null
          id?: string
          indication?: string | null
          instructions?: string | null
          medication_name: string
          medication_reference_id?: string | null
          order_date: string
          order_document_id?: string | null
          order_source?: string | null
          organization_id: string
          pharmacy_name?: string | null
          prescriber_name?: string | null
          prescriber_phone?: string | null
          prn_effectiveness_check_minutes?: number | null
          prn_max_frequency?: string | null
          prn_reason?: string | null
          resident_id: string
          route: Database["public"]["Enums"]["medication_route"]
          scheduled_times?: string[] | null
          start_date: string
          status?: Database["public"]["Enums"]["medication_status"]
          strength?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          controlled_schedule?: Database["public"]["Enums"]["controlled_schedule"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discontinued_by?: string | null
          discontinued_date?: string | null
          discontinued_reason?: string | null
          end_date?: string | null
          facility_id?: string
          form?: string | null
          frequency?: Database["public"]["Enums"]["medication_frequency"]
          frequency_detail?: string | null
          generic_name?: string | null
          id?: string
          indication?: string | null
          instructions?: string | null
          medication_name?: string
          medication_reference_id?: string | null
          order_date?: string
          order_document_id?: string | null
          order_source?: string | null
          organization_id?: string
          pharmacy_name?: string | null
          prescriber_name?: string | null
          prescriber_phone?: string | null
          prn_effectiveness_check_minutes?: number | null
          prn_max_frequency?: string | null
          prn_reason?: string | null
          resident_id?: string
          route?: Database["public"]["Enums"]["medication_route"]
          scheduled_times?: string[] | null
          start_date?: string
          status?: Database["public"]["Enums"]["medication_status"]
          strength?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_medications_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_medications_medication_reference_id_fkey"
            columns: ["medication_reference_id"]
            isOneToOne: false
            referencedRelation: "medication_reference"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_medications_order_document_id_fkey"
            columns: ["order_document_id"]
            isOneToOne: false
            referencedRelation: "resident_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_medications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_medications_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_observation_assignments: {
        Row: {
          assigned_at: string
          assignment_type: Database["public"]["Enums"]["resident_observation_assignment_type"]
          created_at: string
          created_by: string | null
          entity_id: string | null
          facility_id: string
          id: string
          organization_id: string
          reason: string | null
          released_at: string | null
          resident_id: string
          shift_assignment_id: string | null
          staff_id: string
          task_id: string
        }
        Insert: {
          assigned_at?: string
          assignment_type?: Database["public"]["Enums"]["resident_observation_assignment_type"]
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          facility_id: string
          id?: string
          organization_id: string
          reason?: string | null
          released_at?: string | null
          resident_id: string
          shift_assignment_id?: string | null
          staff_id: string
          task_id: string
        }
        Update: {
          assigned_at?: string
          assignment_type?: Database["public"]["Enums"]["resident_observation_assignment_type"]
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          reason?: string | null
          released_at?: string | null
          resident_id?: string
          shift_assignment_id?: string | null
          staff_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resident_observation_assignments_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_assignments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_assignments_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_assignments_shift_assignment_id_fkey"
            columns: ["shift_assignment_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_assignments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "resident_observation_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_observation_escalations: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          entity_id: string | null
          escalated_to_staff_id: string | null
          escalation_level: number
          escalation_type: string
          facility_id: string
          id: string
          organization_id: string
          resident_id: string
          resolution_note: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["resident_observation_follow_up_status"]
          task_id: string
          triggered_at: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id?: string | null
          escalated_to_staff_id?: string | null
          escalation_level?: number
          escalation_type: string
          facility_id: string
          id?: string
          organization_id: string
          resident_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["resident_observation_follow_up_status"]
          task_id: string
          triggered_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id?: string | null
          escalated_to_staff_id?: string | null
          escalation_level?: number
          escalation_type?: string
          facility_id?: string
          id?: string
          organization_id?: string
          resident_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["resident_observation_follow_up_status"]
          task_id?: string
          triggered_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_observation_escalations_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_escalations_escalated_to_staff_id_fkey"
            columns: ["escalated_to_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_escalations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_escalations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_escalations_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_escalations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "resident_observation_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_observation_exceptions: {
        Row: {
          assigned_to_staff_id: string | null
          created_at: string
          deleted_at: string | null
          entity_id: string | null
          exception_type: Database["public"]["Enums"]["resident_observation_exception_type"]
          facility_id: string
          follow_up_status: Database["public"]["Enums"]["resident_observation_follow_up_status"]
          id: string
          linked_incident_id: string | null
          log_id: string
          organization_id: string
          requires_follow_up: boolean
          resident_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["resident_observation_severity"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_to_staff_id?: string | null
          created_at?: string
          deleted_at?: string | null
          entity_id?: string | null
          exception_type: Database["public"]["Enums"]["resident_observation_exception_type"]
          facility_id: string
          follow_up_status?: Database["public"]["Enums"]["resident_observation_follow_up_status"]
          id?: string
          linked_incident_id?: string | null
          log_id: string
          organization_id: string
          requires_follow_up?: boolean
          resident_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["resident_observation_severity"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_to_staff_id?: string | null
          created_at?: string
          deleted_at?: string | null
          entity_id?: string | null
          exception_type?: Database["public"]["Enums"]["resident_observation_exception_type"]
          facility_id?: string
          follow_up_status?: Database["public"]["Enums"]["resident_observation_follow_up_status"]
          id?: string
          linked_incident_id?: string | null
          log_id?: string
          organization_id?: string
          requires_follow_up?: boolean
          resident_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["resident_observation_severity"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_observation_exceptions_assigned_to_staff_id_fkey"
            columns: ["assigned_to_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_exceptions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_exceptions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_exceptions_linked_incident_id_fkey"
            columns: ["linked_incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_exceptions_log_id_fkey"
            columns: ["log_id"]
            isOneToOne: false
            referencedRelation: "resident_observation_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_exceptions_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_observation_integrity_flags: {
        Row: {
          created_at: string
          deleted_at: string | null
          detected_at: string
          disposition_note: string | null
          entity_id: string | null
          facility_id: string
          flag_type: string
          id: string
          log_id: string | null
          organization_id: string
          resident_id: string | null
          reviewed_by: string | null
          severity: Database["public"]["Enums"]["resident_observation_severity"]
          staff_id: string | null
          status: Database["public"]["Enums"]["resident_observation_follow_up_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          detected_at?: string
          disposition_note?: string | null
          entity_id?: string | null
          facility_id: string
          flag_type: string
          id?: string
          log_id?: string | null
          organization_id: string
          resident_id?: string | null
          reviewed_by?: string | null
          severity?: Database["public"]["Enums"]["resident_observation_severity"]
          staff_id?: string | null
          status?: Database["public"]["Enums"]["resident_observation_follow_up_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          detected_at?: string
          disposition_note?: string | null
          entity_id?: string | null
          facility_id?: string
          flag_type?: string
          id?: string
          log_id?: string | null
          organization_id?: string
          resident_id?: string | null
          reviewed_by?: string | null
          severity?: Database["public"]["Enums"]["resident_observation_severity"]
          staff_id?: string | null
          status?: Database["public"]["Enums"]["resident_observation_follow_up_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_observation_integrity_flags_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_integrity_flags_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_integrity_flags_log_id_fkey"
            columns: ["log_id"]
            isOneToOne: false
            referencedRelation: "resident_observation_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_integrity_flags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_integrity_flags_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_integrity_flags_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_observation_logs: {
        Row: {
          assigned_staff_id: string | null
          breathing_concern: boolean
          created_at: string
          created_by: string | null
          deleted_at: string | null
          distress_present: boolean
          entered_at: string
          entity_id: string | null
          entry_mode: Database["public"]["Enums"]["resident_observation_entry_mode"]
          exception_present: boolean
          facility_id: string
          fall_hazard_observed: boolean
          hydration_offered: boolean
          id: string
          intervention_codes: string[]
          late_reason: string | null
          note: string | null
          observed_at: string
          organization_id: string
          pain_concern: boolean
          quick_status: Database["public"]["Enums"]["resident_observation_quick_status"]
          refused_assistance: boolean
          repositioned: boolean
          resident_id: string
          resident_location: string | null
          resident_position: string | null
          resident_state: string | null
          skin_concern_observed: boolean
          staff_id: string
          task_id: string
          toileting_assisted: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_staff_id?: string | null
          breathing_concern?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          distress_present?: boolean
          entered_at?: string
          entity_id?: string | null
          entry_mode?: Database["public"]["Enums"]["resident_observation_entry_mode"]
          exception_present?: boolean
          facility_id: string
          fall_hazard_observed?: boolean
          hydration_offered?: boolean
          id?: string
          intervention_codes?: string[]
          late_reason?: string | null
          note?: string | null
          observed_at: string
          organization_id: string
          pain_concern?: boolean
          quick_status: Database["public"]["Enums"]["resident_observation_quick_status"]
          refused_assistance?: boolean
          repositioned?: boolean
          resident_id: string
          resident_location?: string | null
          resident_position?: string | null
          resident_state?: string | null
          skin_concern_observed?: boolean
          staff_id: string
          task_id: string
          toileting_assisted?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_staff_id?: string | null
          breathing_concern?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          distress_present?: boolean
          entered_at?: string
          entity_id?: string | null
          entry_mode?: Database["public"]["Enums"]["resident_observation_entry_mode"]
          exception_present?: boolean
          facility_id?: string
          fall_hazard_observed?: boolean
          hydration_offered?: boolean
          id?: string
          intervention_codes?: string[]
          late_reason?: string | null
          note?: string | null
          observed_at?: string
          organization_id?: string
          pain_concern?: boolean
          quick_status?: Database["public"]["Enums"]["resident_observation_quick_status"]
          refused_assistance?: boolean
          repositioned?: boolean
          resident_id?: string
          resident_location?: string | null
          resident_position?: string | null
          resident_state?: string | null
          skin_concern_observed?: boolean
          staff_id?: string
          task_id?: string
          toileting_assisted?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_observation_logs_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_logs_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_logs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_logs_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_logs_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_logs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "resident_observation_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_observation_plan_rules: {
        Row: {
          active: boolean
          created_at: string
          daypart_end: string | null
          daypart_start: string | null
          days_of_week: number[]
          deleted_at: string | null
          entity_id: string | null
          escalation_policy_key: string | null
          facility_id: string
          grace_minutes: number
          id: string
          interval_minutes: number | null
          interval_type: Database["public"]["Enums"]["resident_observation_interval_type"]
          organization_id: string
          plan_id: string
          required_fields_schema: Json
          resident_id: string
          shift: Database["public"]["Enums"]["shift_type"] | null
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          daypart_end?: string | null
          daypart_start?: string | null
          days_of_week?: number[]
          deleted_at?: string | null
          entity_id?: string | null
          escalation_policy_key?: string | null
          facility_id: string
          grace_minutes?: number
          id?: string
          interval_minutes?: number | null
          interval_type?: Database["public"]["Enums"]["resident_observation_interval_type"]
          organization_id: string
          plan_id: string
          required_fields_schema?: Json
          resident_id: string
          shift?: Database["public"]["Enums"]["shift_type"] | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          daypart_end?: string | null
          daypart_start?: string | null
          days_of_week?: number[]
          deleted_at?: string | null
          entity_id?: string | null
          escalation_policy_key?: string | null
          facility_id?: string
          grace_minutes?: number
          id?: string
          interval_minutes?: number | null
          interval_type?: Database["public"]["Enums"]["resident_observation_interval_type"]
          organization_id?: string
          plan_id?: string
          required_fields_schema?: Json
          resident_id?: string
          shift?: Database["public"]["Enums"]["shift_type"] | null
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_observation_plan_rules_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_plan_rules_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_plan_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_plan_rules_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "resident_observation_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_plan_rules_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_observation_plans: {
        Row: {
          approved_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          effective_from: string
          effective_to: string | null
          entity_id: string | null
          facility_id: string
          id: string
          organization_id: string
          rationale: string | null
          resident_id: string
          source_type: Database["public"]["Enums"]["resident_observation_source_type"]
          status: Database["public"]["Enums"]["resident_observation_plan_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          effective_from?: string
          effective_to?: string | null
          entity_id?: string | null
          facility_id: string
          id?: string
          organization_id: string
          rationale?: string | null
          resident_id: string
          source_type?: Database["public"]["Enums"]["resident_observation_source_type"]
          status?: Database["public"]["Enums"]["resident_observation_plan_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          effective_from?: string
          effective_to?: string | null
          entity_id?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          rationale?: string | null
          resident_id?: string
          source_type?: Database["public"]["Enums"]["resident_observation_source_type"]
          status?: Database["public"]["Enums"]["resident_observation_plan_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_observation_plans_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_plans_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_plans_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_observation_tasks: {
        Row: {
          assigned_staff_id: string | null
          completed_log_id: string | null
          created_at: string
          deleted_at: string | null
          due_at: string
          entity_id: string | null
          escalated_at: string | null
          excused_by: string | null
          excused_reason: string | null
          facility_id: string
          grace_ends_at: string
          id: string
          notes: string | null
          organization_id: string
          plan_id: string
          plan_rule_id: string | null
          reassigned_from_staff_id: string | null
          reassignment_reason: string | null
          resident_id: string
          scheduled_for: string
          shift_assignment_id: string | null
          status: Database["public"]["Enums"]["resident_observation_task_status"]
          updated_at: string
          updated_by: string | null
          watch_instance_id: string | null
        }
        Insert: {
          assigned_staff_id?: string | null
          completed_log_id?: string | null
          created_at?: string
          deleted_at?: string | null
          due_at: string
          entity_id?: string | null
          escalated_at?: string | null
          excused_by?: string | null
          excused_reason?: string | null
          facility_id: string
          grace_ends_at: string
          id?: string
          notes?: string | null
          organization_id: string
          plan_id: string
          plan_rule_id?: string | null
          reassigned_from_staff_id?: string | null
          reassignment_reason?: string | null
          resident_id: string
          scheduled_for: string
          shift_assignment_id?: string | null
          status?: Database["public"]["Enums"]["resident_observation_task_status"]
          updated_at?: string
          updated_by?: string | null
          watch_instance_id?: string | null
        }
        Update: {
          assigned_staff_id?: string | null
          completed_log_id?: string | null
          created_at?: string
          deleted_at?: string | null
          due_at?: string
          entity_id?: string | null
          escalated_at?: string | null
          excused_by?: string | null
          excused_reason?: string | null
          facility_id?: string
          grace_ends_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          plan_id?: string
          plan_rule_id?: string | null
          reassigned_from_staff_id?: string | null
          reassignment_reason?: string | null
          resident_id?: string
          scheduled_for?: string
          shift_assignment_id?: string | null
          status?: Database["public"]["Enums"]["resident_observation_task_status"]
          updated_at?: string
          updated_by?: string | null
          watch_instance_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_observation_tasks_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_tasks_completed_log_id_fkey"
            columns: ["completed_log_id"]
            isOneToOne: false
            referencedRelation: "resident_observation_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_tasks_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_tasks_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_tasks_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "resident_observation_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_tasks_plan_rule_id_fkey"
            columns: ["plan_rule_id"]
            isOneToOne: false
            referencedRelation: "resident_observation_plan_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_tasks_reassigned_from_staff_id_fkey"
            columns: ["reassigned_from_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_tasks_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_tasks_shift_assignment_id_fkey"
            columns: ["shift_assignment_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_tasks_watch_instance_id_fkey"
            columns: ["watch_instance_id"]
            isOneToOne: false
            referencedRelation: "resident_watch_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_observation_templates: {
        Row: {
          active: boolean
          category: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          entity_id: string | null
          facility_id: string | null
          id: string
          name: string
          organization_id: string
          preset_definition: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          category: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          entity_id?: string | null
          facility_id?: string | null
          id?: string
          name: string
          organization_id: string
          preset_definition?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          entity_id?: string | null
          facility_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          preset_definition?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_observation_templates_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_templates_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_observation_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_payers: {
        Row: {
          benefit_period_months: number | null
          benefits_used_months: number | null
          created_at: string
          created_by: string | null
          daily_benefit_amount: number | null
          deleted_at: string | null
          effective_date: string
          elimination_period_days: number | null
          elimination_period_start_date: string | null
          end_date: string | null
          facility_id: string
          group_number: string | null
          id: string
          is_primary: boolean
          medicaid_authorization_end: string | null
          medicaid_authorization_start: string | null
          medicaid_patient_responsibility: number | null
          medicaid_rate: number | null
          medicaid_recipient_id: string | null
          monthly_benefit_amount: number | null
          notes: string | null
          organization_id: string
          payer_contact_name: string | null
          payer_fixed_amount: number | null
          payer_name: string | null
          payer_percentage: number | null
          payer_phone: string | null
          payer_share_type: string
          payer_type: Database["public"]["Enums"]["payer_type"]
          policy_number: string | null
          remaining_benefits_months: number | null
          resident_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          benefit_period_months?: number | null
          benefits_used_months?: number | null
          created_at?: string
          created_by?: string | null
          daily_benefit_amount?: number | null
          deleted_at?: string | null
          effective_date: string
          elimination_period_days?: number | null
          elimination_period_start_date?: string | null
          end_date?: string | null
          facility_id: string
          group_number?: string | null
          id?: string
          is_primary?: boolean
          medicaid_authorization_end?: string | null
          medicaid_authorization_start?: string | null
          medicaid_patient_responsibility?: number | null
          medicaid_rate?: number | null
          medicaid_recipient_id?: string | null
          monthly_benefit_amount?: number | null
          notes?: string | null
          organization_id: string
          payer_contact_name?: string | null
          payer_fixed_amount?: number | null
          payer_name?: string | null
          payer_percentage?: number | null
          payer_phone?: string | null
          payer_share_type?: string
          payer_type: Database["public"]["Enums"]["payer_type"]
          policy_number?: string | null
          remaining_benefits_months?: number | null
          resident_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          benefit_period_months?: number | null
          benefits_used_months?: number | null
          created_at?: string
          created_by?: string | null
          daily_benefit_amount?: number | null
          deleted_at?: string | null
          effective_date?: string
          elimination_period_days?: number | null
          elimination_period_start_date?: string | null
          end_date?: string | null
          facility_id?: string
          group_number?: string | null
          id?: string
          is_primary?: boolean
          medicaid_authorization_end?: string | null
          medicaid_authorization_start?: string | null
          medicaid_patient_responsibility?: number | null
          medicaid_rate?: number | null
          medicaid_recipient_id?: string | null
          monthly_benefit_amount?: number | null
          notes?: string | null
          organization_id?: string
          payer_contact_name?: string | null
          payer_fixed_amount?: number | null
          payer_name?: string | null
          payer_percentage?: number | null
          payer_phone?: string | null
          payer_share_type?: string
          payer_type?: Database["public"]["Enums"]["payer_type"]
          policy_number?: string | null
          remaining_benefits_months?: number | null
          resident_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_payers_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_payers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_payers_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_photos: {
        Row: {
          anatomical_location: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          facility_id: string
          id: string
          linked_assessment_id: string | null
          linked_incident_id: string | null
          organization_id: string
          photo_type: string
          resident_id: string
          storage_path: string
          taken_at: string
          taken_by: string
          wound_stage: string | null
        }
        Insert: {
          anatomical_location?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          facility_id: string
          id?: string
          linked_assessment_id?: string | null
          linked_incident_id?: string | null
          organization_id: string
          photo_type: string
          resident_id: string
          storage_path: string
          taken_at?: string
          taken_by: string
          wound_stage?: string | null
        }
        Update: {
          anatomical_location?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          facility_id?: string
          id?: string
          linked_assessment_id?: string | null
          linked_incident_id?: string | null
          organization_id?: string
          photo_type?: string
          resident_id?: string
          storage_path?: string
          taken_at?: string
          taken_by?: string
          wound_stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_photos_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_photos_linked_assessment_id_fkey"
            columns: ["linked_assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_photos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_photos_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_transport_requests: {
        Row: {
          appointment_date: string
          appointment_time: string | null
          cancellation_reason: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          destination_address: string | null
          destination_name: string
          driver_staff_id: string | null
          escort_required: boolean
          escort_staff_id: string | null
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          pickup_time: string | null
          purpose: string
          requested_by: string
          resident_id: string
          return_time: string | null
          status: Database["public"]["Enums"]["transport_request_status"]
          transport_type: Database["public"]["Enums"]["transport_type"]
          updated_at: string
          updated_by: string | null
          vehicle_id: string | null
          wheelchair_required: boolean
        }
        Insert: {
          appointment_date: string
          appointment_time?: string | null
          cancellation_reason?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          destination_address?: string | null
          destination_name: string
          driver_staff_id?: string | null
          escort_required?: boolean
          escort_staff_id?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          pickup_time?: string | null
          purpose: string
          requested_by: string
          resident_id: string
          return_time?: string | null
          status?: Database["public"]["Enums"]["transport_request_status"]
          transport_type?: Database["public"]["Enums"]["transport_type"]
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
          wheelchair_required?: boolean
        }
        Update: {
          appointment_date?: string
          appointment_time?: string | null
          cancellation_reason?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          destination_address?: string | null
          destination_name?: string
          driver_staff_id?: string | null
          escort_required?: boolean
          escort_staff_id?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          pickup_time?: string | null
          purpose?: string
          requested_by?: string
          resident_id?: string
          return_time?: string | null
          status?: Database["public"]["Enums"]["transport_request_status"]
          transport_type?: Database["public"]["Enums"]["transport_type"]
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
          wheelchair_required?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "resident_transport_requests_driver_staff_id_fkey"
            columns: ["driver_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_transport_requests_escort_staff_id_fkey"
            columns: ["escort_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_transport_requests_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_transport_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_transport_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_transport_requests_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_transport_requests_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "fleet_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_watch_events: {
        Row: {
          created_at: string
          created_by: string | null
          entity_id: string | null
          event_type: string
          facility_id: string
          id: string
          log_id: string | null
          note: string | null
          occurred_at: string
          organization_id: string
          resident_id: string
          task_id: string | null
          watch_instance_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          event_type: string
          facility_id: string
          id?: string
          log_id?: string | null
          note?: string | null
          occurred_at?: string
          organization_id: string
          resident_id: string
          task_id?: string | null
          watch_instance_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          event_type?: string
          facility_id?: string
          id?: string
          log_id?: string | null
          note?: string | null
          occurred_at?: string
          organization_id?: string
          resident_id?: string
          task_id?: string | null
          watch_instance_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resident_watch_events_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_watch_events_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_watch_events_log_id_fkey"
            columns: ["log_id"]
            isOneToOne: false
            referencedRelation: "resident_observation_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_watch_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_watch_events_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_watch_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "resident_observation_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_watch_events_watch_instance_id_fkey"
            columns: ["watch_instance_id"]
            isOneToOne: false
            referencedRelation: "resident_watch_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_watch_instances: {
        Row: {
          approved_by: string | null
          created_at: string
          deleted_at: string | null
          end_reason: string | null
          ended_by: string | null
          ends_at: string | null
          entity_id: string | null
          facility_id: string
          id: string
          organization_id: string
          protocol_id: string | null
          resident_id: string
          starts_at: string
          status: Database["public"]["Enums"]["resident_watch_status"]
          triggered_by_id: string | null
          triggered_by_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          deleted_at?: string | null
          end_reason?: string | null
          ended_by?: string | null
          ends_at?: string | null
          entity_id?: string | null
          facility_id: string
          id?: string
          organization_id: string
          protocol_id?: string | null
          resident_id: string
          starts_at?: string
          status?: Database["public"]["Enums"]["resident_watch_status"]
          triggered_by_id?: string | null
          triggered_by_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          deleted_at?: string | null
          end_reason?: string | null
          ended_by?: string | null
          ends_at?: string | null
          entity_id?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          protocol_id?: string | null
          resident_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["resident_watch_status"]
          triggered_by_id?: string | null
          triggered_by_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_watch_instances_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_watch_instances_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_watch_instances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_watch_instances_protocol_id_fkey"
            columns: ["protocol_id"]
            isOneToOne: false
            referencedRelation: "resident_watch_protocols"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_watch_instances_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      resident_watch_protocols: {
        Row: {
          active: boolean
          approval_required: boolean
          created_at: string
          created_by: string | null
          deleted_at: string | null
          duration_rule: string | null
          entity_id: string | null
          facility_id: string
          id: string
          name: string
          organization_id: string
          rule_definition_json: Json
          trigger_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          approval_required?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          duration_rule?: string | null
          entity_id?: string | null
          facility_id: string
          id?: string
          name: string
          organization_id: string
          rule_definition_json?: Json
          trigger_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          approval_required?: boolean
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          duration_rule?: string | null
          entity_id?: string | null
          facility_id?: string
          id?: string
          name?: string
          organization_id?: string
          rule_definition_json?: Json
          trigger_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resident_watch_protocols_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_watch_protocols_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resident_watch_protocols_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      residents: {
        Row: {
          activity_preferences: string | null
          acuity_level: Database["public"]["Enums"]["acuity_level"] | null
          acuity_score: number | null
          admission_date: string | null
          admission_source: string | null
          advance_directive_on_file: boolean
          advance_directive_type: string | null
          allergy_list: string[] | null
          ambulatory: boolean
          assistive_device: string | null
          bed_id: string | null
          code_status: string
          created_at: string
          created_by: string | null
          date_of_birth: string
          deleted_at: string | null
          diagnosis_list: string[] | null
          diet_order: string | null
          diet_restrictions: string[] | null
          discharge_date: string | null
          discharge_destination: string | null
          discharge_notes: string | null
          discharge_reason:
            | Database["public"]["Enums"]["discharge_reason"]
            | null
          discharge_target_date: string | null
          elopement_risk: boolean
          emergency_contact_1_name: string | null
          emergency_contact_1_phone: string | null
          emergency_contact_1_relationship: string | null
          emergency_contact_2_name: string | null
          emergency_contact_2_phone: string | null
          emergency_contact_2_relationship: string | null
          facility_id: string
          fall_risk_level: string | null
          first_name: string
          food_preferences: string | null
          gender: Database["public"]["Enums"]["gender"]
          hospice_status: Database["public"]["Enums"]["hospice_status"]
          id: string
          last_name: string
          middle_name: string | null
          monthly_base_rate: number | null
          monthly_care_surcharge: number | null
          monthly_total_rate: number | null
          organization_id: string
          photo_url: string | null
          preferred_bed_time: string | null
          preferred_name: string | null
          preferred_shower_days: string[] | null
          preferred_wake_time: string | null
          primary_diagnosis: string | null
          primary_payer: Database["public"]["Enums"]["payer_type"]
          primary_physician_fax: string | null
          primary_physician_name: string | null
          primary_physician_phone: string | null
          rate_effective_date: string | null
          referral_source_id: string | null
          religious_preference: string | null
          responsible_party_address: string | null
          responsible_party_email: string | null
          responsible_party_name: string | null
          responsible_party_phone: string | null
          responsible_party_relationship: string | null
          secondary_payer: Database["public"]["Enums"]["payer_type"] | null
          smoking_status: string | null
          special_instructions: string | null
          ssn_last_four: string | null
          status: Database["public"]["Enums"]["resident_status"]
          updated_at: string
          updated_by: string | null
          wandering_risk: boolean
        }
        Insert: {
          activity_preferences?: string | null
          acuity_level?: Database["public"]["Enums"]["acuity_level"] | null
          acuity_score?: number | null
          admission_date?: string | null
          admission_source?: string | null
          advance_directive_on_file?: boolean
          advance_directive_type?: string | null
          allergy_list?: string[] | null
          ambulatory?: boolean
          assistive_device?: string | null
          bed_id?: string | null
          code_status?: string
          created_at?: string
          created_by?: string | null
          date_of_birth: string
          deleted_at?: string | null
          diagnosis_list?: string[] | null
          diet_order?: string | null
          diet_restrictions?: string[] | null
          discharge_date?: string | null
          discharge_destination?: string | null
          discharge_notes?: string | null
          discharge_reason?:
            | Database["public"]["Enums"]["discharge_reason"]
            | null
          discharge_target_date?: string | null
          elopement_risk?: boolean
          emergency_contact_1_name?: string | null
          emergency_contact_1_phone?: string | null
          emergency_contact_1_relationship?: string | null
          emergency_contact_2_name?: string | null
          emergency_contact_2_phone?: string | null
          emergency_contact_2_relationship?: string | null
          facility_id: string
          fall_risk_level?: string | null
          first_name: string
          food_preferences?: string | null
          gender: Database["public"]["Enums"]["gender"]
          hospice_status?: Database["public"]["Enums"]["hospice_status"]
          id?: string
          last_name: string
          middle_name?: string | null
          monthly_base_rate?: number | null
          monthly_care_surcharge?: number | null
          monthly_total_rate?: number | null
          organization_id: string
          photo_url?: string | null
          preferred_bed_time?: string | null
          preferred_name?: string | null
          preferred_shower_days?: string[] | null
          preferred_wake_time?: string | null
          primary_diagnosis?: string | null
          primary_payer?: Database["public"]["Enums"]["payer_type"]
          primary_physician_fax?: string | null
          primary_physician_name?: string | null
          primary_physician_phone?: string | null
          rate_effective_date?: string | null
          referral_source_id?: string | null
          religious_preference?: string | null
          responsible_party_address?: string | null
          responsible_party_email?: string | null
          responsible_party_name?: string | null
          responsible_party_phone?: string | null
          responsible_party_relationship?: string | null
          secondary_payer?: Database["public"]["Enums"]["payer_type"] | null
          smoking_status?: string | null
          special_instructions?: string | null
          ssn_last_four?: string | null
          status?: Database["public"]["Enums"]["resident_status"]
          updated_at?: string
          updated_by?: string | null
          wandering_risk?: boolean
        }
        Update: {
          activity_preferences?: string | null
          acuity_level?: Database["public"]["Enums"]["acuity_level"] | null
          acuity_score?: number | null
          admission_date?: string | null
          admission_source?: string | null
          advance_directive_on_file?: boolean
          advance_directive_type?: string | null
          allergy_list?: string[] | null
          ambulatory?: boolean
          assistive_device?: string | null
          bed_id?: string | null
          code_status?: string
          created_at?: string
          created_by?: string | null
          date_of_birth?: string
          deleted_at?: string | null
          diagnosis_list?: string[] | null
          diet_order?: string | null
          diet_restrictions?: string[] | null
          discharge_date?: string | null
          discharge_destination?: string | null
          discharge_notes?: string | null
          discharge_reason?:
            | Database["public"]["Enums"]["discharge_reason"]
            | null
          discharge_target_date?: string | null
          elopement_risk?: boolean
          emergency_contact_1_name?: string | null
          emergency_contact_1_phone?: string | null
          emergency_contact_1_relationship?: string | null
          emergency_contact_2_name?: string | null
          emergency_contact_2_phone?: string | null
          emergency_contact_2_relationship?: string | null
          facility_id?: string
          fall_risk_level?: string | null
          first_name?: string
          food_preferences?: string | null
          gender?: Database["public"]["Enums"]["gender"]
          hospice_status?: Database["public"]["Enums"]["hospice_status"]
          id?: string
          last_name?: string
          middle_name?: string | null
          monthly_base_rate?: number | null
          monthly_care_surcharge?: number | null
          monthly_total_rate?: number | null
          organization_id?: string
          photo_url?: string | null
          preferred_bed_time?: string | null
          preferred_name?: string | null
          preferred_shower_days?: string[] | null
          preferred_wake_time?: string | null
          primary_diagnosis?: string | null
          primary_payer?: Database["public"]["Enums"]["payer_type"]
          primary_physician_fax?: string | null
          primary_physician_name?: string | null
          primary_physician_phone?: string | null
          rate_effective_date?: string | null
          referral_source_id?: string | null
          religious_preference?: string | null
          responsible_party_address?: string | null
          responsible_party_email?: string | null
          responsible_party_name?: string | null
          responsible_party_phone?: string | null
          responsible_party_relationship?: string | null
          secondary_payer?: Database["public"]["Enums"]["payer_type"] | null
          smoking_status?: string | null
          special_instructions?: string | null
          ssn_last_four?: string | null
          status?: Database["public"]["Enums"]["resident_status"]
          updated_at?: string
          updated_by?: string | null
          wandering_risk?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "residents_bed_id_fkey"
            columns: ["bed_id"]
            isOneToOne: false
            referencedRelation: "beds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "residents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "residents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "residents_referral_source_id_fkey"
            columns: ["referral_source_id"]
            isOneToOne: false
            referencedRelation: "referral_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          app_role: string
          created_at: string
          description: string | null
          feature: string
          id: string
          permission_level: string
          updated_at: string
        }
        Insert: {
          app_role: string
          created_at?: string
          description?: string | null
          feature: string
          id?: string
          permission_level: string
          updated_at?: string
        }
        Update: {
          app_role?: string
          created_at?: string
          description?: string | null
          feature?: string
          id?: string
          permission_level?: string
          updated_at?: string
        }
        Relationships: []
      }
      rooms: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          floor_number: number | null
          has_bathroom: boolean
          id: string
          is_ada_accessible: boolean
          max_occupancy: number
          near_nursing_station: boolean
          notes: string | null
          organization_id: string
          room_number: string
          room_type: Database["public"]["Enums"]["room_type"]
          sort_order: number
          unit_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          floor_number?: number | null
          has_bathroom?: boolean
          id?: string
          is_ada_accessible?: boolean
          max_occupancy?: number
          near_nursing_station?: boolean
          notes?: string | null
          organization_id: string
          room_number: string
          room_type?: Database["public"]["Enums"]["room_type"]
          sort_order?: number
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          floor_number?: number | null
          has_bathroom?: boolean
          id?: string
          is_ada_accessible?: boolean
          max_occupancy?: number
          near_nursing_station?: boolean
          notes?: string | null
          organization_id?: string
          room_number?: string
          room_type?: Database["public"]["Enums"]["room_type"]
          sort_order?: number
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rooms_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          published_at: string | null
          published_by: string | null
          status: Database["public"]["Enums"]["schedule_status"]
          updated_at: string
          updated_by: string | null
          week_start_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          published_at?: string | null
          published_by?: string | null
          status?: Database["public"]["Enums"]["schedule_status"]
          updated_at?: string
          updated_by?: string | null
          week_start_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          published_at?: string | null
          published_by?: string | null
          status?: Database["public"]["Enums"]["schedule_status"]
          updated_at?: string
          updated_by?: string | null
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      search_documents: {
        Row: {
          deleted_at: string | null
          facility_id: string | null
          id: string
          label: string | null
          organization_id: string
          search_tsv: unknown
          source_id: string
          source_table: string
          updated_at: string
        }
        Insert: {
          deleted_at?: string | null
          facility_id?: string | null
          id?: string
          label?: string | null
          organization_id: string
          search_tsv?: unknown
          source_id: string
          source_table: string
          updated_at?: string
        }
        Update: {
          deleted_at?: string | null
          facility_id?: string | null
          id?: string
          label?: string | null
          organization_id?: string
          search_tsv?: unknown
          source_id?: string
          source_table?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_documents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_assignments: {
        Row: {
          assigned_resident_ids: string[] | null
          created_at: string
          created_by: string | null
          custom_end_time: string | null
          custom_start_time: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          schedule_id: string
          shift_classification: Database["public"]["Enums"]["shift_classification"]
          shift_date: string
          shift_type: Database["public"]["Enums"]["shift_type"]
          staff_id: string
          status: Database["public"]["Enums"]["shift_assignment_status"]
          unit_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_resident_ids?: string[] | null
          created_at?: string
          created_by?: string | null
          custom_end_time?: string | null
          custom_start_time?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          schedule_id: string
          shift_classification?: Database["public"]["Enums"]["shift_classification"]
          shift_date: string
          shift_type: Database["public"]["Enums"]["shift_type"]
          staff_id: string
          status?: Database["public"]["Enums"]["shift_assignment_status"]
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_resident_ids?: string[] | null
          created_at?: string
          created_by?: string | null
          custom_end_time?: string | null
          custom_start_time?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          schedule_id?: string
          shift_classification?: Database["public"]["Enums"]["shift_classification"]
          shift_date?: string
          shift_type?: Database["public"]["Enums"]["shift_type"]
          staff_id?: string
          status?: Database["public"]["Enums"]["shift_assignment_status"]
          unit_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_assignments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_handoffs: {
        Row: {
          auto_summary: Json
          created_at: string
          deleted_at: string | null
          facility_id: string
          handoff_date: string
          id: string
          incoming_acknowledged: boolean
          incoming_acknowledged_at: string | null
          incoming_notes: string | null
          incoming_shift: Database["public"]["Enums"]["shift_type"]
          incoming_staff_id: string | null
          organization_id: string
          outgoing_notes: string | null
          outgoing_shift: Database["public"]["Enums"]["shift_type"]
          outgoing_staff_id: string
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          auto_summary?: Json
          created_at?: string
          deleted_at?: string | null
          facility_id: string
          handoff_date: string
          id?: string
          incoming_acknowledged?: boolean
          incoming_acknowledged_at?: string | null
          incoming_notes?: string | null
          incoming_shift: Database["public"]["Enums"]["shift_type"]
          incoming_staff_id?: string | null
          organization_id: string
          outgoing_notes?: string | null
          outgoing_shift: Database["public"]["Enums"]["shift_type"]
          outgoing_staff_id: string
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_summary?: Json
          created_at?: string
          deleted_at?: string | null
          facility_id?: string
          handoff_date?: string
          id?: string
          incoming_acknowledged?: boolean
          incoming_acknowledged_at?: string | null
          incoming_notes?: string | null
          incoming_shift?: Database["public"]["Enums"]["shift_type"]
          incoming_staff_id?: string | null
          organization_id?: string
          outgoing_notes?: string | null
          outgoing_shift?: Database["public"]["Enums"]["shift_type"]
          outgoing_staff_id?: string
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_handoffs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_handoffs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_handoffs_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_swap_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          claimed_at: string | null
          covering_assignment_id: string | null
          covering_staff_id: string | null
          created_at: string
          deleted_at: string | null
          denied_reason: string | null
          facility_id: string
          id: string
          organization_id: string
          reason: string | null
          requesting_assignment_id: string
          requesting_staff_id: string
          status: string
          swap_type: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          claimed_at?: string | null
          covering_assignment_id?: string | null
          covering_staff_id?: string | null
          created_at?: string
          deleted_at?: string | null
          denied_reason?: string | null
          facility_id: string
          id?: string
          organization_id: string
          reason?: string | null
          requesting_assignment_id: string
          requesting_staff_id: string
          status?: string
          swap_type: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          claimed_at?: string | null
          covering_assignment_id?: string | null
          covering_staff_id?: string | null
          created_at?: string
          deleted_at?: string | null
          denied_reason?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          reason?: string | null
          requesting_assignment_id?: string
          requesting_staff_id?: string
          status?: string
          swap_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_swap_requests_covering_assignment_id_fkey"
            columns: ["covering_assignment_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_covering_staff_id_fkey"
            columns: ["covering_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_requesting_assignment_id_fkey"
            columns: ["requesting_assignment_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_requesting_staff_id_fkey"
            columns: ["requesting_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          city: string | null
          created_at: string
          created_by: string | null
          date_of_birth: string | null
          deleted_at: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          employment_status: Database["public"]["Enums"]["employment_status"]
          excluded_from_care: boolean
          facility_id: string
          first_name: string
          hire_date: string
          hourly_rate: number | null
          id: string
          is_float_pool: boolean
          is_full_time: boolean
          last_name: string
          max_hours_per_week: number | null
          notes: string | null
          organization_id: string
          overtime_rate: number | null
          phone: string | null
          phone_alt: string | null
          photo_url: string | null
          preferred_name: string | null
          ssn_last_four: string | null
          staff_role: Database["public"]["Enums"]["staff_role"]
          state: string | null
          termination_date: string | null
          termination_reason: string | null
          updated_at: string
          updated_by: string | null
          user_id: string | null
          zip: string | null
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          employment_status?: Database["public"]["Enums"]["employment_status"]
          excluded_from_care?: boolean
          facility_id: string
          first_name: string
          hire_date: string
          hourly_rate?: number | null
          id?: string
          is_float_pool?: boolean
          is_full_time?: boolean
          last_name: string
          max_hours_per_week?: number | null
          notes?: string | null
          organization_id: string
          overtime_rate?: number | null
          phone?: string | null
          phone_alt?: string | null
          photo_url?: string | null
          preferred_name?: string | null
          ssn_last_four?: string | null
          staff_role: Database["public"]["Enums"]["staff_role"]
          state?: string | null
          termination_date?: string | null
          termination_reason?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          zip?: string | null
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          date_of_birth?: string | null
          deleted_at?: string | null
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          employment_status?: Database["public"]["Enums"]["employment_status"]
          excluded_from_care?: boolean
          facility_id?: string
          first_name?: string
          hire_date?: string
          hourly_rate?: number | null
          id?: string
          is_float_pool?: boolean
          is_full_time?: boolean
          last_name?: string
          max_hours_per_week?: number | null
          notes?: string | null
          organization_id?: string
          overtime_rate?: number | null
          phone?: string | null
          phone_alt?: string | null
          photo_url?: string | null
          preferred_name?: string | null
          ssn_last_four?: string | null
          staff_role?: Database["public"]["Enums"]["staff_role"]
          state?: string | null
          termination_date?: string | null
          termination_reason?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_background_checks: {
        Row: {
          checked_at: string | null
          clearinghouse_id: string | null
          created_at: string
          deleted_at: string | null
          document_storage_path: string | null
          expires_at: string | null
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          result: Database["public"]["Enums"]["background_check_result"]
          staff_id: string
          updated_at: string
        }
        Insert: {
          checked_at?: string | null
          clearinghouse_id?: string | null
          created_at?: string
          deleted_at?: string | null
          document_storage_path?: string | null
          expires_at?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          result?: Database["public"]["Enums"]["background_check_result"]
          staff_id: string
          updated_at?: string
        }
        Update: {
          checked_at?: string | null
          clearinghouse_id?: string | null
          created_at?: string
          deleted_at?: string | null
          document_storage_path?: string | null
          expires_at?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          result?: Database["public"]["Enums"]["background_check_result"]
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_background_checks_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_background_checks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_background_checks_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_certifications: {
        Row: {
          certificate_number: string | null
          certification_name: string
          certification_type: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          document_id: string | null
          expiration_date: string | null
          facility_id: string
          id: string
          issue_date: string
          issuing_authority: string | null
          notes: string | null
          organization_id: string
          staff_id: string
          status: Database["public"]["Enums"]["certification_status"]
          storage_path: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          certificate_number?: string | null
          certification_name: string
          certification_type: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_id?: string | null
          expiration_date?: string | null
          facility_id: string
          id?: string
          issue_date: string
          issuing_authority?: string | null
          notes?: string | null
          organization_id: string
          staff_id: string
          status?: Database["public"]["Enums"]["certification_status"]
          storage_path?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          certificate_number?: string | null
          certification_name?: string
          certification_type?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_id?: string | null
          expiration_date?: string | null
          facility_id?: string
          id?: string
          issue_date?: string
          issuing_authority?: string | null
          notes?: string | null
          organization_id?: string
          staff_id?: string
          status?: Database["public"]["Enums"]["certification_status"]
          storage_path?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_certifications_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "resident_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_certifications_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_certifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_certifications_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_illness_records: {
        Row: {
          absent_from: string
          absent_to: string | null
          clearance_notes: string | null
          clearance_type: string | null
          cleared_at: string | null
          cleared_by: string | null
          clearing_provider: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          illness_type: string
          organization_id: string
          reported_date: string
          return_cleared: boolean
          return_to_work_clearance_at: string | null
          shifts_missed: number | null
          staff_id: string
          symptoms: string[] | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          absent_from: string
          absent_to?: string | null
          clearance_notes?: string | null
          clearance_type?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          clearing_provider?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          illness_type: string
          organization_id: string
          reported_date: string
          return_cleared?: boolean
          return_to_work_clearance_at?: string | null
          shifts_missed?: number | null
          staff_id: string
          symptoms?: string[] | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          absent_from?: string
          absent_to?: string | null
          clearance_notes?: string | null
          clearance_type?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          clearing_provider?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          illness_type?: string
          organization_id?: string
          reported_date?: string
          return_cleared?: boolean
          return_to_work_clearance_at?: string | null
          shifts_missed?: number | null
          staff_id?: string
          symptoms?: string[] | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_illness_records_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_illness_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_illness_records_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_training_completions: {
        Row: {
          attachment_path: string | null
          certificate_number: string | null
          completed_at: string
          created_at: string
          created_by: string
          deleted_at: string | null
          delivery_method: Database["public"]["Enums"]["training_delivery_method"]
          evaluator_user_id: string | null
          expires_at: string | null
          external_provider: string | null
          facility_id: string
          hours_completed: number | null
          id: string
          notes: string | null
          organization_id: string
          staff_id: string
          training_program_id: string
          updated_at: string
        }
        Insert: {
          attachment_path?: string | null
          certificate_number?: string | null
          completed_at: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          delivery_method: Database["public"]["Enums"]["training_delivery_method"]
          evaluator_user_id?: string | null
          expires_at?: string | null
          external_provider?: string | null
          facility_id: string
          hours_completed?: number | null
          id?: string
          notes?: string | null
          organization_id: string
          staff_id: string
          training_program_id: string
          updated_at?: string
        }
        Update: {
          attachment_path?: string | null
          certificate_number?: string | null
          completed_at?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          delivery_method?: Database["public"]["Enums"]["training_delivery_method"]
          evaluator_user_id?: string | null
          expires_at?: string | null
          external_provider?: string | null
          facility_id?: string
          hours_completed?: number | null
          id?: string
          notes?: string | null
          organization_id?: string
          staff_id?: string
          training_program_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_training_completions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_training_completions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_training_completions_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_training_completions_training_program_id_fkey"
            columns: ["training_program_id"]
            isOneToOne: false
            referencedRelation: "training_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      staffing_ratio_snapshots: {
        Row: {
          created_at: string
          facility_id: string
          id: string
          is_compliant: boolean
          organization_id: string
          ratio: number
          required_ratio: number
          residents_present: number
          shift: Database["public"]["Enums"]["shift_type"]
          snapshot_at: string
          staff_detail: Json
          staff_on_duty: number
        }
        Insert: {
          created_at?: string
          facility_id: string
          id?: string
          is_compliant: boolean
          organization_id: string
          ratio: number
          required_ratio: number
          residents_present: number
          shift: Database["public"]["Enums"]["shift_type"]
          snapshot_at?: string
          staff_detail?: Json
          staff_on_duty: number
        }
        Update: {
          created_at?: string
          facility_id?: string
          id?: string
          is_compliant?: boolean
          organization_id?: string
          ratio?: number
          required_ratio?: number
          residents_present?: number
          shift?: Database["public"]["Enums"]["shift_type"]
          snapshot_at?: string
          staff_detail?: Json
          staff_on_duty?: number
        }
        Relationships: [
          {
            foreignKeyName: "staffing_ratio_snapshots_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staffing_ratio_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_deficiencies: {
        Row: {
          corrected_at: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string
          facility_id: string
          follow_up_notes: string | null
          follow_up_survey_date: string | null
          id: string
          organization_id: string
          regulatory_rule_citation: string | null
          scope: string
          severity: string
          status: string
          survey_date: string
          survey_type: string
          surveyor_agency: string
          surveyor_name: string | null
          tag_description: string
          tag_number: string
          updated_at: string
          updated_by: string | null
          verified_at: string | null
        }
        Insert: {
          corrected_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description: string
          facility_id: string
          follow_up_notes?: string | null
          follow_up_survey_date?: string | null
          id?: string
          organization_id: string
          regulatory_rule_citation?: string | null
          scope?: string
          severity: string
          status?: string
          survey_date: string
          survey_type: string
          surveyor_agency?: string
          surveyor_name?: string | null
          tag_description: string
          tag_number: string
          updated_at?: string
          updated_by?: string | null
          verified_at?: string | null
        }
        Update: {
          corrected_at?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string
          facility_id?: string
          follow_up_notes?: string | null
          follow_up_survey_date?: string | null
          id?: string
          organization_id?: string
          regulatory_rule_citation?: string | null
          scope?: string
          severity?: string
          status?: string
          survey_date?: string
          survey_type?: string
          surveyor_agency?: string
          surveyor_name?: string | null
          tag_description?: string
          tag_number?: string
          updated_at?: string
          updated_by?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "survey_deficiencies_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_deficiencies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_deficiencies_regulatory_rule_citation_fkey"
            columns: ["regulatory_rule_citation"]
            isOneToOne: false
            referencedRelation: "regulatory_rules"
            referencedColumns: ["citation"]
          },
        ]
      }
      survey_visit_log_entries: {
        Row: {
          accessed_at: string
          accessed_by: string
          created_at: string
          facility_id: string
          id: string
          organization_id: string
          record_description: string
          record_id: string | null
          record_type: string
          session_id: string
        }
        Insert: {
          accessed_at?: string
          accessed_by: string
          created_at?: string
          facility_id: string
          id?: string
          organization_id: string
          record_description: string
          record_id?: string | null
          record_type: string
          session_id: string
        }
        Update: {
          accessed_at?: string
          accessed_by?: string
          created_at?: string
          facility_id?: string
          id?: string
          organization_id?: string
          record_description?: string
          record_id?: string | null
          record_type?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_visit_log_entries_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_visit_log_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_visit_log_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "survey_visit_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_visit_sessions: {
        Row: {
          activated_at: string
          activated_by: string
          created_at: string
          deactivated_at: string | null
          deactivated_by: string | null
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
        }
        Insert: {
          activated_at?: string
          activated_by: string
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
        }
        Update: {
          activated_at?: string
          activated_by?: string
          created_at?: string
          deactivated_at?: string | null
          deactivated_by?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_visit_sessions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_visit_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      time_records: {
        Row: {
          actual_hours: number | null
          approved: boolean
          approved_at: string | null
          approved_by: string | null
          break_minutes: number | null
          clock_in: string
          clock_in_latitude: number | null
          clock_in_longitude: number | null
          clock_in_method: string
          clock_out: string | null
          clock_out_latitude: number | null
          clock_out_longitude: number | null
          clock_out_method: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          discrepancy_notes: string | null
          facility_id: string
          id: string
          organization_id: string
          overtime_hours: number | null
          regular_hours: number | null
          scheduled_hours: number | null
          shift_assignment_id: string | null
          staff_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actual_hours?: number | null
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          break_minutes?: number | null
          clock_in: string
          clock_in_latitude?: number | null
          clock_in_longitude?: number | null
          clock_in_method: string
          clock_out?: string | null
          clock_out_latitude?: number | null
          clock_out_longitude?: number | null
          clock_out_method?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discrepancy_notes?: string | null
          facility_id: string
          id?: string
          organization_id: string
          overtime_hours?: number | null
          regular_hours?: number | null
          scheduled_hours?: number | null
          shift_assignment_id?: string | null
          staff_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actual_hours?: number | null
          approved?: boolean
          approved_at?: string | null
          approved_by?: string | null
          break_minutes?: number | null
          clock_in?: string
          clock_in_latitude?: number | null
          clock_in_longitude?: number | null
          clock_in_method?: string
          clock_out?: string | null
          clock_out_latitude?: number | null
          clock_out_longitude?: number | null
          clock_out_method?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discrepancy_notes?: string | null
          facility_id?: string
          id?: string
          organization_id?: string
          overtime_hours?: number | null
          regular_hours?: number | null
          scheduled_hours?: number | null
          shift_assignment_id?: string | null
          staff_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "time_records_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_records_shift_assignment_id_fkey"
            columns: ["shift_assignment_id"]
            isOneToOne: false
            referencedRelation: "shift_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_records_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      training_programs: {
        Row: {
          active: boolean
          applies_to_roles: string[]
          code: string
          created_at: string
          deleted_at: string | null
          delivery_method: Database["public"]["Enums"]["training_delivery_method"]
          description: string | null
          external_provider: string | null
          frequency: Database["public"]["Enums"]["training_frequency"]
          id: string
          is_fl_required: boolean
          is_mandatory: boolean
          name: string
          organization_id: string
          regulatory_cite: string | null
          required_hours: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          applies_to_roles?: string[]
          code: string
          created_at?: string
          deleted_at?: string | null
          delivery_method?: Database["public"]["Enums"]["training_delivery_method"]
          description?: string | null
          external_provider?: string | null
          frequency: Database["public"]["Enums"]["training_frequency"]
          id?: string
          is_fl_required?: boolean
          is_mandatory?: boolean
          name: string
          organization_id: string
          regulatory_cite?: string | null
          required_hours?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          applies_to_roles?: string[]
          code?: string
          created_at?: string
          deleted_at?: string | null
          delivery_method?: Database["public"]["Enums"]["training_delivery_method"]
          description?: string | null
          external_provider?: string | null
          frequency?: Database["public"]["Enums"]["training_frequency"]
          id?: string
          is_fl_required?: boolean
          is_mandatory?: boolean
          name?: string
          organization_id?: string
          regulatory_cite?: string | null
          required_hours?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_programs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trust_account_entries: {
        Row: {
          amount_cents: number
          balance_after_cents: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          entry_date: string
          entry_type: string
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          reference_id: string | null
          reference_type: string | null
          resident_id: string
        }
        Insert: {
          amount_cents: number
          balance_after_cents: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entry_date: string
          entry_type: string
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          reference_id?: string | null
          reference_type?: string | null
          resident_id: string
        }
        Update: {
          amount_cents?: number
          balance_after_cents?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entry_date?: string
          entry_type?: string
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          reference_id?: string | null
          reference_type?: string | null
          resident_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trust_account_entries_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trust_account_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trust_account_entries_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      units: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          floor_number: number | null
          id: string
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          floor_number?: number | null
          id?: string
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          floor_number?: number | null
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "units_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_counters: {
        Row: {
          bucket_date: string
          id: string
          queries: number | null
          tokens_in: number | null
          tokens_out: number | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          bucket_date?: string
          id?: string
          queries?: number | null
          tokens_in?: number | null
          tokens_out?: number | null
          user_id: string
          workspace_id?: string
        }
        Update: {
          bucket_date?: string
          id?: string
          queries?: number | null
          tokens_in?: number | null
          tokens_out?: number | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      user_facility_access: {
        Row: {
          facility_id: string
          granted_at: string
          granted_by: string | null
          id: string
          is_primary: boolean
          organization_id: string
          revoked_at: string | null
          revoked_by: string | null
          user_id: string
        }
        Insert: {
          facility_id: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_primary?: boolean
          organization_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          user_id: string
        }
        Update: {
          facility_id?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_primary?: boolean
          organization_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_facility_access_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_facility_access_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_management_audit_log: {
        Row: {
          acting_user_id: string
          action: string
          changes: Json
          created_at: string
          id: string
          ip_address: unknown
          organization_id: string
          reason: string | null
          resource_type: string
          target_user_id: string
          user_agent: string | null
        }
        Insert: {
          acting_user_id: string
          action: string
          changes?: Json
          created_at?: string
          id?: string
          ip_address?: unknown
          organization_id: string
          reason?: string | null
          resource_type?: string
          target_user_id: string
          user_agent?: string | null
        }
        Update: {
          acting_user_id?: string
          action?: string
          changes?: Json
          created_at?: string
          id?: string
          ip_address?: unknown
          organization_id?: string
          reason?: string | null
          resource_type?: string
          target_user_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_management_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_management_audit_log_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          app_role: Database["public"]["Enums"]["app_role"]
          auth_claim_version: number
          avatar_url: string | null
          created_at: string
          deleted_at: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean
          job_title: string | null
          last_login_at: string | null
          manager_user_id: string | null
          mfa_enforced_at: string | null
          organization_id: string | null
          phone: string | null
          settings: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          app_role: Database["public"]["Enums"]["app_role"]
          auth_claim_version?: number
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          email: string
          full_name: string
          id: string
          is_active?: boolean
          job_title?: string | null
          last_login_at?: string | null
          manager_user_id?: string | null
          mfa_enforced_at?: string | null
          organization_id?: string | null
          phone?: string | null
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          app_role?: Database["public"]["Enums"]["app_role"]
          auth_claim_version?: number
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          job_title?: string | null
          last_login_at?: string | null
          manager_user_id?: string | null
          mfa_enforced_at?: string | null
          organization_id?: string | null
          phone?: string | null
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_manager_user_id_fkey"
            columns: ["manager_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_inspection_logs: {
        Row: {
          created_at: string
          created_by: string | null
          defects_notes: string | null
          deleted_at: string | null
          facility_id: string
          fleet_vehicle_id: string
          id: string
          inspected_at: string
          inspector_label: string | null
          odometer_miles: number | null
          organization_id: string
          result: Database["public"]["Enums"]["vehicle_inspection_result"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          defects_notes?: string | null
          deleted_at?: string | null
          facility_id: string
          fleet_vehicle_id: string
          id?: string
          inspected_at?: string
          inspector_label?: string | null
          odometer_miles?: number | null
          organization_id: string
          result?: Database["public"]["Enums"]["vehicle_inspection_result"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          defects_notes?: string | null
          deleted_at?: string | null
          facility_id?: string
          fleet_vehicle_id?: string
          id?: string
          inspected_at?: string
          inspector_label?: string | null
          odometer_miles?: number | null
          organization_id?: string
          result?: Database["public"]["Enums"]["vehicle_inspection_result"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_inspection_logs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_inspection_logs_fleet_vehicle_id_fkey"
            columns: ["fleet_vehicle_id"]
            isOneToOne: false
            referencedRelation: "fleet_vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_inspection_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_facilities: {
        Row: {
          created_at: string
          deleted_at: string | null
          facility_id: string
          id: string
          is_primary: boolean
          organization_id: string
          vendor_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          facility_id: string
          id?: string
          is_primary?: boolean
          organization_id: string
          vendor_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          facility_id?: string
          id?: string
          is_primary?: boolean
          organization_id?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_facilities_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_facilities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_facilities_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_insurance: {
        Row: {
          additional_insured: boolean
          carrier_name: string | null
          certificate_of_insurance_id: string | null
          compliant: boolean
          created_at: string
          deleted_at: string | null
          effective_date: string
          expiration_date: string
          id: string
          insurance_type: string
          notes: string | null
          organization_id: string
          policy_number: string | null
          updated_at: string
          vendor_id: string
        }
        Insert: {
          additional_insured?: boolean
          carrier_name?: string | null
          certificate_of_insurance_id?: string | null
          compliant?: boolean
          created_at?: string
          deleted_at?: string | null
          effective_date: string
          expiration_date: string
          id?: string
          insurance_type: string
          notes?: string | null
          organization_id: string
          policy_number?: string | null
          updated_at?: string
          vendor_id: string
        }
        Update: {
          additional_insured?: boolean
          carrier_name?: string | null
          certificate_of_insurance_id?: string | null
          compliant?: boolean
          created_at?: string
          deleted_at?: string | null
          effective_date?: string
          expiration_date?: string
          id?: string
          insurance_type?: string
          notes?: string | null
          organization_id?: string
          policy_number?: string | null
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_insurance_certificate_of_insurance_id_fkey"
            columns: ["certificate_of_insurance_id"]
            isOneToOne: false
            referencedRelation: "certificates_of_insurance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_insurance_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_insurance_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_invoice_lines: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          line_number: number
          line_total_cents: number
          organization_id: string
          po_line_item_id: string | null
          quantity: number
          unit_cost_cents: number
          vendor_invoice_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description: string
          id?: string
          line_number: number
          line_total_cents?: number
          organization_id: string
          po_line_item_id?: string | null
          quantity?: number
          unit_cost_cents?: number
          vendor_invoice_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          line_number?: number
          line_total_cents?: number
          organization_id?: string
          po_line_item_id?: string | null
          quantity?: number
          unit_cost_cents?: number
          vendor_invoice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_invoice_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoice_lines_po_line_item_id_fkey"
            columns: ["po_line_item_id"]
            isOneToOne: false
            referencedRelation: "po_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoice_lines_vendor_invoice_id_fkey"
            columns: ["vendor_invoice_id"]
            isOneToOne: false
            referencedRelation: "vendor_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_invoices: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          document_storage_path: string | null
          due_date: string
          facility_id: string
          id: string
          invoice_date: string
          invoice_number: string
          notes: string | null
          organization_id: string
          purchase_order_id: string | null
          status: Database["public"]["Enums"]["vendor_invoice_status"]
          total_cents: number
          updated_at: string
          updated_by: string | null
          vendor_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_storage_path?: string | null
          due_date: string
          facility_id: string
          id?: string
          invoice_date: string
          invoice_number: string
          notes?: string | null
          organization_id: string
          purchase_order_id?: string | null
          status?: Database["public"]["Enums"]["vendor_invoice_status"]
          total_cents?: number
          updated_at?: string
          updated_by?: string | null
          vendor_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          document_storage_path?: string | null
          due_date?: string
          facility_id?: string
          id?: string
          invoice_date?: string
          invoice_number?: string
          notes?: string | null
          organization_id?: string
          purchase_order_id?: string | null
          status?: Database["public"]["Enums"]["vendor_invoice_status"]
          total_cents?: number
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_invoices_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_payment_applications: {
        Row: {
          applied_amount_cents: number
          created_at: string
          deleted_at: string | null
          id: string
          organization_id: string
          vendor_invoice_id: string
          vendor_payment_id: string
        }
        Insert: {
          applied_amount_cents: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id: string
          vendor_invoice_id: string
          vendor_payment_id: string
        }
        Update: {
          applied_amount_cents?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string
          vendor_invoice_id?: string
          vendor_payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_payment_applications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payment_applications_vendor_invoice_id_fkey"
            columns: ["vendor_invoice_id"]
            isOneToOne: false
            referencedRelation: "vendor_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payment_applications_vendor_payment_id_fkey"
            columns: ["vendor_payment_id"]
            isOneToOne: false
            referencedRelation: "vendor_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_payments: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          entity_id: string
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          payment_date: string
          payment_method: string
          reference_number: string | null
          updated_at: string
          updated_by: string | null
          vendor_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id: string
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          payment_date: string
          payment_method: string
          reference_number?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          entity_id?: string
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          payment_date?: string
          payment_method?: string
          reference_number?: string | null
          updated_at?: string
          updated_by?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_payments_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payments_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_po_sequences: {
        Row: {
          last_number: number
          organization_id: string
          year: string
        }
        Insert: {
          last_number?: number
          organization_id: string
          year: string
        }
        Update: {
          last_number?: number
          organization_id?: string
          year?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_po_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_scorecard_signals: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          payload_json: Json
          signal_date: string
          signal_key: string
          signal_value: number | null
          vendor_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          payload_json?: Json
          signal_date?: string
          signal_key: string
          signal_value?: number | null
          vendor_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          payload_json?: Json
          signal_date?: string
          signal_key?: string
          signal_value?: number | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_scorecard_signals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_scorecard_signals_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_scorecards: {
        Row: {
          compliance_score: number | null
          cost_score: number | null
          created_at: string
          deleted_at: string | null
          id: string
          organization_id: string
          quality_score: number | null
          review_period_end: string
          review_period_start: string
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_notes: string | null
          timeliness_score: number | null
          updated_at: string
          vendor_id: string
        }
        Insert: {
          compliance_score?: number | null
          cost_score?: number | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id: string
          quality_score?: number | null
          review_period_end: string
          review_period_start: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          timeliness_score?: number | null
          updated_at?: string
          vendor_id: string
        }
        Update: {
          compliance_score?: number | null
          cost_score?: number | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string
          quality_score?: number | null
          review_period_end?: string
          review_period_start?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          timeliness_score?: number | null
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_scorecards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_scorecards_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          category: Database["public"]["Enums"]["vendor_category"]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          primary_contact_email: string | null
          primary_contact_name: string | null
          primary_contact_phone: string | null
          remit_to_address: string | null
          status: Database["public"]["Enums"]["vendor_status"]
          tax_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: Database["public"]["Enums"]["vendor_category"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          primary_contact_phone?: string | null
          remit_to_address?: string | null
          status?: Database["public"]["Enums"]["vendor_status"]
          tax_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["vendor_category"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          primary_contact_email?: string | null
          primary_contact_name?: string | null
          primary_contact_phone?: string | null
          remit_to_address?: string | null
          status?: Database["public"]["Enums"]["vendor_status"]
          tax_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      verbal_orders: {
        Row: {
          cosignature_due_at: string
          cosignature_status: string
          cosigned_at: string | null
          cosigned_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          facility_id: string
          id: string
          implementation_notes: string | null
          implemented: boolean
          implemented_at: string | null
          implemented_by: string | null
          indication: string | null
          linked_medication_id: string | null
          order_text: string
          order_type: string
          organization_id: string
          physician_signed_date: string | null
          prescriber_name: string
          prescriber_phone: string | null
          read_back_confirmed: boolean
          received_at: string
          received_by: string
          resident_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cosignature_due_at: string
          cosignature_status?: string
          cosigned_at?: string | null
          cosigned_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id: string
          id?: string
          implementation_notes?: string | null
          implemented?: boolean
          implemented_at?: string | null
          implemented_by?: string | null
          indication?: string | null
          linked_medication_id?: string | null
          order_text: string
          order_type: string
          organization_id: string
          physician_signed_date?: string | null
          prescriber_name: string
          prescriber_phone?: string | null
          read_back_confirmed?: boolean
          received_at?: string
          received_by: string
          resident_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cosignature_due_at?: string
          cosignature_status?: string
          cosigned_at?: string | null
          cosigned_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          facility_id?: string
          id?: string
          implementation_notes?: string | null
          implemented?: boolean
          implemented_at?: string | null
          implemented_by?: string | null
          indication?: string | null
          linked_medication_id?: string | null
          order_text?: string
          order_type?: string
          organization_id?: string
          physician_signed_date?: string | null
          prescriber_name?: string
          prescriber_phone?: string | null
          read_back_confirmed?: boolean
          received_at?: string
          received_by?: string
          resident_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verbal_orders_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verbal_orders_linked_medication_id_fkey"
            columns: ["linked_medication_id"]
            isOneToOne: false
            referencedRelation: "resident_medications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verbal_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verbal_orders_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      vital_sign_alert_thresholds: {
        Row: {
          bp_diastolic_high: number | null
          bp_diastolic_low: number | null
          bp_systolic_high: number | null
          bp_systolic_low: number | null
          configured_at: string
          configured_by: string
          created_at: string
          deleted_at: string | null
          facility_id: string
          id: string
          notes: string | null
          organization_id: string
          oxygen_saturation_low: number | null
          pulse_high: number | null
          pulse_low: number | null
          resident_id: string
          respiration_high: number | null
          respiration_low: number | null
          temperature_high: number | null
          temperature_low: number | null
          updated_at: string
          updated_by: string | null
          weight_change_lbs: number | null
        }
        Insert: {
          bp_diastolic_high?: number | null
          bp_diastolic_low?: number | null
          bp_systolic_high?: number | null
          bp_systolic_low?: number | null
          configured_at?: string
          configured_by: string
          created_at?: string
          deleted_at?: string | null
          facility_id: string
          id?: string
          notes?: string | null
          organization_id: string
          oxygen_saturation_low?: number | null
          pulse_high?: number | null
          pulse_low?: number | null
          resident_id: string
          respiration_high?: number | null
          respiration_low?: number | null
          temperature_high?: number | null
          temperature_low?: number | null
          updated_at?: string
          updated_by?: string | null
          weight_change_lbs?: number | null
        }
        Update: {
          bp_diastolic_high?: number | null
          bp_diastolic_low?: number | null
          bp_systolic_high?: number | null
          bp_systolic_low?: number | null
          configured_at?: string
          configured_by?: string
          created_at?: string
          deleted_at?: string | null
          facility_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          oxygen_saturation_low?: number | null
          pulse_high?: number | null
          pulse_low?: number | null
          resident_id?: string
          respiration_high?: number | null
          respiration_low?: number | null
          temperature_high?: number | null
          temperature_low?: number | null
          updated_at?: string
          updated_by?: string | null
          weight_change_lbs?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vital_sign_alert_thresholds_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_sign_alert_thresholds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_sign_alert_thresholds_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      vital_sign_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          daily_log_id: string
          deleted_at: string | null
          direction: string
          facility_id: string
          id: string
          organization_id: string
          recorded_value: number
          resident_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          threshold_value: number
          vital_type: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          daily_log_id: string
          deleted_at?: string | null
          direction: string
          facility_id: string
          id?: string
          organization_id: string
          recorded_value: number
          resident_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          threshold_value: number
          vital_type: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          daily_log_id?: string
          deleted_at?: string | null
          direction?: string
          facility_id?: string
          id?: string
          organization_id?: string
          recorded_value?: number
          resident_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          threshold_value?: number
          vital_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "vital_sign_alerts_daily_log_id_fkey"
            columns: ["daily_log_id"]
            isOneToOne: false
            referencedRelation: "daily_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_sign_alerts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_sign_alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_sign_alerts_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      workers_comp_claims: {
        Row: {
          claim_number: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          facility_id: string
          first_report_filed_at: string | null
          id: string
          injury_date: string
          modified_duty_end: string | null
          modified_duty_start: string | null
          organization_id: string
          osha_300_line_id: string | null
          osha_recordable: boolean
          paid_cents: number
          reserve_cents: number
          return_to_work_date: string | null
          staff_id: string | null
          status: Database["public"]["Enums"]["insurance_claim_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          claim_number?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          facility_id: string
          first_report_filed_at?: string | null
          id?: string
          injury_date: string
          modified_duty_end?: string | null
          modified_duty_start?: string | null
          organization_id: string
          osha_300_line_id?: string | null
          osha_recordable?: boolean
          paid_cents?: number
          reserve_cents?: number
          return_to_work_date?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["insurance_claim_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          claim_number?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          facility_id?: string
          first_report_filed_at?: string | null
          id?: string
          injury_date?: string
          modified_duty_end?: string | null
          modified_duty_start?: string | null
          organization_id?: string
          osha_300_line_id?: string | null
          osha_recordable?: boolean
          paid_cents?: number
          reserve_cents?: number
          return_to_work_date?: string | null
          staff_id?: string | null
          status?: Database["public"]["Enums"]["insurance_claim_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workers_comp_claims_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workers_comp_claims_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workers_comp_claims_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      ar_aging_facility_daily: {
        Row: {
          balance_due_cents: number | null
          bucket_date: string | null
          facility_id: string | null
          invoice_count: number | null
          organization_id: string | null
          resident_id: string | null
          status: Database["public"]["Enums"]["invoice_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_latest_facility_measures: {
        Row: {
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          facility_id: string | null
          id: string | null
          notes: string | null
          organization_id: string | null
          period_end: string | null
          period_start: string | null
          quality_measure_id: string | null
          source: string | null
          updated_at: string | null
          updated_by: string | null
          value_numeric: number | null
          value_text: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_measure_results_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_measure_results_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_measure_results_quality_measure_id_fkey"
            columns: ["quality_measure_id"]
            isOneToOne: false
            referencedRelation: "quality_measures"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      allocate_incident_number: {
        Args: { p_facility_id: string }
        Returns: string
      }
      allocate_vendor_po_number: {
        Args: { p_organization_id: string }
        Returns: string
      }
      document_role_can_view_audience: {
        Args: { doc_audience: string; user_role: string }
        Returns: boolean
      }
      increment_usage: {
        Args: {
          p_tokens_in: number
          p_tokens_out: number
          p_user_id: string
          p_workspace_id: string
        }
        Returns: undefined
      }
      log_knowledge_gap: {
        Args: {
          p_question: string
          p_trace_id?: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: {
          created_at: string
          frequency: number
          id: string
          last_asked_at: string
          question: string
          question_normalized: string | null
          resolution_document_id: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          trace_id: string | null
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "knowledge_gaps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      retrieve_evidence: {
        Args: {
          keyword_query: string
          match_count?: number
          p_workspace_id?: string
          query_embedding: string
          semantic_threshold?: number
          user_role: string
        }
        Returns: {
          access_class: string
          confidence: number
          excerpt: string
          page_number: number
          parent_content: string
          section_title: string
          source_id: string
          source_title: string
          source_type: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      acuity_level: "level_1" | "level_2" | "level_3"
      admission_accommodation_quote: "private" | "semi_private"
      admission_case_status:
        | "pending_clearance"
        | "bed_reserved"
        | "move_in"
        | "cancelled"
      ai_phi_class: "none" | "limited" | "phi"
      app_role:
        | "owner"
        | "org_admin"
        | "facility_admin"
        | "manager"
        | "admin_assistant"
        | "coordinator"
        | "nurse"
        | "caregiver"
        | "dietary"
        | "maintenance_role"
        | "housekeeper"
        | "family"
        | "broker"
      assistance_level:
        | "independent"
        | "supervision"
        | "limited_assist"
        | "extensive_assist"
        | "total_dependence"
      audit_log_export_format: "csv" | "pdf"
      audit_log_export_status: "pending" | "processing" | "completed" | "failed"
      background_check_result:
        | "pending"
        | "clear"
        | "review"
        | "adverse"
        | "expired"
      bed_status: "available" | "occupied" | "hold" | "maintenance" | "offline"
      bed_type: "alf_intermediate" | "memory_care" | "independent_living"
      care_plan_item_category:
        | "mobility"
        | "bathing"
        | "dressing"
        | "grooming"
        | "toileting"
        | "eating"
        | "medication_assistance"
        | "behavioral"
        | "fall_prevention"
        | "skin_integrity"
        | "pain_management"
        | "cognitive"
        | "social"
        | "dietary"
        | "other"
      care_plan_status: "draft" | "active" | "under_review" | "archived"
      certification_status: "active" | "expired" | "pending_renewal" | "revoked"
      coi_holder_type: "vendor" | "landlord" | "lender" | "other"
      competency_demonstration_status:
        | "draft"
        | "submitted"
        | "passed"
        | "failed"
        | "voided"
      contract_alert_status:
        | "pending"
        | "acknowledged"
        | "resolved"
        | "dismissed"
      contract_alert_type:
        | "renewal"
        | "termination_notice"
        | "auto_renew"
        | "price_escalation"
        | "coi_expiration"
        | "other"
      contract_type:
        | "service"
        | "lease"
        | "license"
        | "subscription"
        | "maintenance"
        | "other"
      controlled_schedule: "ii" | "iii" | "iv" | "v" | "non_controlled"
      diet_order_status: "draft" | "active" | "discontinued"
      discharge_med_reconciliation_status:
        | "draft"
        | "pharmacist_review"
        | "complete"
        | "cancelled"
      discharge_reason:
        | "higher_level_of_care"
        | "hospital_permanent"
        | "another_alf"
        | "home"
        | "death"
        | "non_payment"
        | "behavioral"
        | "other"
      driver_credential_status: "active" | "suspended" | "expired"
      emar_status:
        | "scheduled"
        | "given"
        | "refused"
        | "held"
        | "not_available"
        | "self_administered"
      employment_status: "active" | "on_leave" | "terminated" | "suspended"
      entity_status: "active" | "inactive" | "archived"
      exec_alert_severity: "critical" | "warning" | "info"
      exec_alert_source_module:
        | "billing"
        | "finance"
        | "incidents"
        | "infection"
        | "compliance"
        | "staff"
        | "medications"
        | "insurance"
        | "vendors"
        | "system"
      exec_nlq_session_status: "draft" | "submitted" | "completed" | "failed"
      exec_report_template:
        | "ops_weekly"
        | "financial_monthly"
        | "board_quarterly"
        | "custom"
      exec_snapshot_scope: "organization" | "entity" | "facility"
      facility_status: "active" | "inactive" | "under_renovation" | "archived"
      family_care_conference_status: "scheduled" | "completed" | "cancelled"
      family_message_author: "family" | "staff"
      family_message_triage_status:
        | "pending_review"
        | "in_review"
        | "resolved"
        | "false_positive"
      fleet_vehicle_status: "active" | "out_of_service" | "retired"
      gender: "male" | "female" | "other" | "prefer_not_to_say"
      gl_account_type: "asset" | "liability" | "equity" | "revenue" | "expense"
      hospice_status: "none" | "pending" | "active" | "ended"
      iddsi_fluid_level:
        | "not_assessed"
        | "level_0_thin"
        | "level_1_slightly_thick"
        | "level_2_mildly_thick"
        | "level_3_moderately_thick"
        | "level_4_extremely_thick"
      iddsi_food_level:
        | "not_assessed"
        | "level_3_liquidized"
        | "level_4_pureed"
        | "level_5_minced_moist"
        | "level_6_soft_bite_sized"
        | "level_7_regular_easy_chew"
      incident_category:
        | "fall_with_injury"
        | "fall_without_injury"
        | "fall_witnessed"
        | "fall_unwitnessed"
        | "elopement"
        | "wandering"
        | "medication_error"
        | "medication_refusal"
        | "skin_integrity"
        | "pressure_injury"
        | "unexplained_bruise"
        | "behavioral_resident_to_resident"
        | "behavioral_resident_to_staff"
        | "behavioral_self_harm"
        | "abuse_allegation"
        | "neglect_allegation"
        | "property_damage"
        | "property_loss"
        | "environmental_fire"
        | "environmental_flood"
        | "environmental_power"
        | "environmental_pest"
        | "infection"
        | "other"
      incident_severity: "level_1" | "level_2" | "level_3" | "level_4"
      incident_status: "open" | "investigating" | "resolved" | "closed"
      insurance_claim_status:
        | "reported"
        | "investigating"
        | "reserved"
        | "partially_paid"
        | "closed"
        | "denied"
        | "withdrawn"
      insurance_policy_status:
        | "draft"
        | "active"
        | "expired"
        | "cancelled"
        | "pending_renewal"
      insurance_policy_type:
        | "general_liability"
        | "property"
        | "workers_comp"
        | "auto"
        | "umbrella"
        | "directors_officers"
        | "cyber"
        | "epli"
        | "professional"
        | "other"
      insurance_renewal_status:
        | "upcoming"
        | "in_progress"
        | "bound"
        | "expired"
        | "declined"
      invoice_status:
        | "draft"
        | "sent"
        | "paid"
        | "partial"
        | "overdue"
        | "void"
        | "written_off"
      journal_entry_status: "draft" | "posted" | "voided"
      medication_frequency:
        | "daily"
        | "bid"
        | "tid"
        | "qid"
        | "qhs"
        | "qam"
        | "prn"
        | "weekly"
        | "biweekly"
        | "monthly"
        | "other"
      medication_route:
        | "oral"
        | "sublingual"
        | "topical"
        | "ophthalmic"
        | "otic"
        | "nasal"
        | "inhaled"
        | "rectal"
        | "transdermal"
        | "subcutaneous"
        | "intramuscular"
        | "other"
      medication_status: "active" | "discontinued" | "on_hold" | "completed"
      org_status: "active" | "suspended" | "archived"
      payer_type:
        | "private_pay"
        | "medicaid_oss"
        | "ltc_insurance"
        | "va_aid_attendance"
        | "other"
      payment_method:
        | "check"
        | "ach"
        | "credit_card"
        | "cash"
        | "medicaid_payment"
        | "insurance_payment"
        | "other"
      payroll_export_batch_status:
        | "draft"
        | "queued"
        | "exported"
        | "failed"
        | "voided"
      pbj_export_batch_status: "pending" | "processing" | "complete" | "failed"
      pii_access_tier: "public_summary" | "standard_ops" | "clinical_precheck"
      po_status:
        | "draft"
        | "submitted"
        | "approved"
        | "partially_received"
        | "received"
        | "closed"
        | "cancelled"
      polst_status: "none" | "on_file" | "verified" | "revoked"
      premium_allocation_method:
        | "per_licensed_bed"
        | "per_census_day"
        | "pct_of_premium"
        | "custom"
      referral_hl7_inbound_status:
        | "pending"
        | "processed"
        | "failed"
        | "ignored"
      referral_lead_status:
        | "new"
        | "contacted"
        | "tour_scheduled"
        | "tour_completed"
        | "application_pending"
        | "waitlisted"
        | "converted"
        | "lost"
        | "merged"
      report_export_format: "csv" | "pdf" | "print" | "xlsx"
      report_owner_type: "system" | "organization" | "facility" | "user"
      report_run_status:
        | "queued"
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
      report_schedule_status: "active" | "paused" | "failed"
      report_sharing_scope: "private" | "team" | "facility" | "organization"
      report_source_type: "template" | "saved_view" | "pack"
      report_template_status: "draft" | "active" | "deprecated" | "archived"
      reputation_platform:
        | "google_business"
        | "yelp"
        | "facebook"
        | "caring_com"
        | "other"
      reputation_reply_status: "draft" | "posted" | "failed"
      resident_observation_assignment_type:
        | "primary"
        | "reassignment"
        | "rescue"
      resident_observation_entry_mode:
        | "live"
        | "late"
        | "offline_synced"
        | "bulk"
      resident_observation_exception_type:
        | "resident_not_found"
        | "resident_declined_interaction"
        | "resident_appears_ill"
        | "resident_appears_injured"
        | "environmental_hazard_present"
        | "family_concern_reported"
        | "assignment_impossible"
        | "other"
      resident_observation_follow_up_status:
        | "open"
        | "in_progress"
        | "resolved"
        | "dismissed"
      resident_observation_interval_type:
        | "continuous"
        | "fixed_minutes"
        | "per_shift"
        | "daypart"
      resident_observation_plan_status:
        | "draft"
        | "active"
        | "paused"
        | "ended"
        | "cancelled"
      resident_observation_quick_status:
        | "awake"
        | "asleep"
        | "calm"
        | "agitated"
        | "confused"
        | "distressed"
        | "not_found"
        | "refused"
      resident_observation_severity: "low" | "medium" | "high" | "critical"
      resident_observation_source_type:
        | "care_plan"
        | "manual"
        | "policy"
        | "order"
        | "triggered"
      resident_observation_task_status:
        | "upcoming"
        | "due_soon"
        | "due_now"
        | "overdue"
        | "critically_overdue"
        | "missed"
        | "completed_on_time"
        | "completed_late"
        | "excused"
        | "reassigned"
        | "escalated"
      resident_status:
        | "inquiry"
        | "pending_admission"
        | "active"
        | "hospital_hold"
        | "loa"
        | "discharged"
        | "deceased"
      resident_watch_status:
        | "pending_approval"
        | "active"
        | "paused"
        | "ended"
        | "cancelled"
      room_type: "private" | "semi_private" | "shared"
      schedule_status: "draft" | "published" | "archived"
      shift_assignment_status:
        | "assigned"
        | "confirmed"
        | "swap_requested"
        | "called_out"
        | "no_show"
        | "completed"
      shift_classification:
        | "regular"
        | "on_call"
        | "agency"
        | "training"
        | "other"
      shift_type: "day" | "evening" | "night" | "custom"
      staff_role:
        | "cna"
        | "lpn"
        | "rn"
        | "administrator"
        | "activities_director"
        | "dietary_staff"
        | "dietary_manager"
        | "maintenance"
        | "housekeeping"
        | "driver"
        | "other"
      training_delivery_method: "in_person" | "external" | "online" | "hybrid"
      training_frequency:
        | "at_hire"
        | "annual"
        | "biennial"
        | "as_needed"
        | "one_time"
      transport_request_status:
        | "requested"
        | "scheduled"
        | "in_progress"
        | "completed"
        | "cancelled"
      transport_type:
        | "facility_vehicle"
        | "staff_personal_vehicle"
        | "third_party"
      vehicle_inspection_result: "pass" | "fail" | "conditional"
      vendor_category:
        | "maintenance"
        | "medical_supply"
        | "pharmacy"
        | "food_service"
        | "staffing_agency"
        | "consulting"
        | "technology"
        | "other"
      vendor_invoice_status:
        | "draft"
        | "submitted"
        | "approved"
        | "matched"
        | "paid"
        | "voided"
      vendor_status: "draft" | "active" | "inactive" | "blocked"
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
      acuity_level: ["level_1", "level_2", "level_3"],
      admission_accommodation_quote: ["private", "semi_private"],
      admission_case_status: [
        "pending_clearance",
        "bed_reserved",
        "move_in",
        "cancelled",
      ],
      ai_phi_class: ["none", "limited", "phi"],
      app_role: [
        "owner",
        "org_admin",
        "facility_admin",
        "manager",
        "admin_assistant",
        "coordinator",
        "nurse",
        "caregiver",
        "dietary",
        "maintenance_role",
        "housekeeper",
        "family",
        "broker",
      ],
      assistance_level: [
        "independent",
        "supervision",
        "limited_assist",
        "extensive_assist",
        "total_dependence",
      ],
      audit_log_export_format: ["csv", "pdf"],
      audit_log_export_status: ["pending", "processing", "completed", "failed"],
      background_check_result: [
        "pending",
        "clear",
        "review",
        "adverse",
        "expired",
      ],
      bed_status: ["available", "occupied", "hold", "maintenance", "offline"],
      bed_type: ["alf_intermediate", "memory_care", "independent_living"],
      care_plan_item_category: [
        "mobility",
        "bathing",
        "dressing",
        "grooming",
        "toileting",
        "eating",
        "medication_assistance",
        "behavioral",
        "fall_prevention",
        "skin_integrity",
        "pain_management",
        "cognitive",
        "social",
        "dietary",
        "other",
      ],
      care_plan_status: ["draft", "active", "under_review", "archived"],
      certification_status: ["active", "expired", "pending_renewal", "revoked"],
      coi_holder_type: ["vendor", "landlord", "lender", "other"],
      competency_demonstration_status: [
        "draft",
        "submitted",
        "passed",
        "failed",
        "voided",
      ],
      contract_alert_status: [
        "pending",
        "acknowledged",
        "resolved",
        "dismissed",
      ],
      contract_alert_type: [
        "renewal",
        "termination_notice",
        "auto_renew",
        "price_escalation",
        "coi_expiration",
        "other",
      ],
      contract_type: [
        "service",
        "lease",
        "license",
        "subscription",
        "maintenance",
        "other",
      ],
      controlled_schedule: ["ii", "iii", "iv", "v", "non_controlled"],
      diet_order_status: ["draft", "active", "discontinued"],
      discharge_med_reconciliation_status: [
        "draft",
        "pharmacist_review",
        "complete",
        "cancelled",
      ],
      discharge_reason: [
        "higher_level_of_care",
        "hospital_permanent",
        "another_alf",
        "home",
        "death",
        "non_payment",
        "behavioral",
        "other",
        "resident_voluntary",
        "facility_with_cause",
        "facility_immediate",
        "medicaid_relocation",
      ],
      driver_credential_status: ["active", "suspended", "expired"],
      emar_status: [
        "scheduled",
        "given",
        "refused",
        "held",
        "not_available",
        "self_administered",
      ],
      employment_status: ["active", "on_leave", "terminated", "suspended"],
      entity_status: ["active", "inactive", "archived"],
      exec_alert_severity: ["critical", "warning", "info"],
      exec_alert_source_module: [
        "billing",
        "finance",
        "incidents",
        "infection",
        "compliance",
        "staff",
        "medications",
        "insurance",
        "vendors",
        "system",
      ],
      exec_nlq_session_status: ["draft", "submitted", "completed", "failed"],
      exec_report_template: [
        "ops_weekly",
        "financial_monthly",
        "board_quarterly",
        "custom",
      ],
      exec_snapshot_scope: ["organization", "entity", "facility"],
      facility_status: ["active", "inactive", "under_renovation", "archived"],
      family_care_conference_status: ["scheduled", "completed", "cancelled"],
      family_message_author: ["family", "staff"],
      family_message_triage_status: [
        "pending_review",
        "in_review",
        "resolved",
        "false_positive",
      ],
      fleet_vehicle_status: ["active", "out_of_service", "retired"],
      gender: ["male", "female", "other", "prefer_not_to_say"],
      gl_account_type: ["asset", "liability", "equity", "revenue", "expense"],
      hospice_status: ["none", "pending", "active", "ended"],
      iddsi_fluid_level: [
        "not_assessed",
        "level_0_thin",
        "level_1_slightly_thick",
        "level_2_mildly_thick",
        "level_3_moderately_thick",
        "level_4_extremely_thick",
      ],
      iddsi_food_level: [
        "not_assessed",
        "level_3_liquidized",
        "level_4_pureed",
        "level_5_minced_moist",
        "level_6_soft_bite_sized",
        "level_7_regular_easy_chew",
      ],
      incident_category: [
        "fall_with_injury",
        "fall_without_injury",
        "fall_witnessed",
        "fall_unwitnessed",
        "elopement",
        "wandering",
        "medication_error",
        "medication_refusal",
        "skin_integrity",
        "pressure_injury",
        "unexplained_bruise",
        "behavioral_resident_to_resident",
        "behavioral_resident_to_staff",
        "behavioral_self_harm",
        "abuse_allegation",
        "neglect_allegation",
        "property_damage",
        "property_loss",
        "environmental_fire",
        "environmental_flood",
        "environmental_power",
        "environmental_pest",
        "infection",
        "other",
      ],
      incident_severity: ["level_1", "level_2", "level_3", "level_4"],
      incident_status: ["open", "investigating", "resolved", "closed"],
      insurance_claim_status: [
        "reported",
        "investigating",
        "reserved",
        "partially_paid",
        "closed",
        "denied",
        "withdrawn",
      ],
      insurance_policy_status: [
        "draft",
        "active",
        "expired",
        "cancelled",
        "pending_renewal",
      ],
      insurance_policy_type: [
        "general_liability",
        "property",
        "workers_comp",
        "auto",
        "umbrella",
        "directors_officers",
        "cyber",
        "epli",
        "professional",
        "other",
      ],
      insurance_renewal_status: [
        "upcoming",
        "in_progress",
        "bound",
        "expired",
        "declined",
      ],
      invoice_status: [
        "draft",
        "sent",
        "paid",
        "partial",
        "overdue",
        "void",
        "written_off",
      ],
      journal_entry_status: ["draft", "posted", "voided"],
      medication_frequency: [
        "daily",
        "bid",
        "tid",
        "qid",
        "qhs",
        "qam",
        "prn",
        "weekly",
        "biweekly",
        "monthly",
        "other",
      ],
      medication_route: [
        "oral",
        "sublingual",
        "topical",
        "ophthalmic",
        "otic",
        "nasal",
        "inhaled",
        "rectal",
        "transdermal",
        "subcutaneous",
        "intramuscular",
        "other",
      ],
      medication_status: ["active", "discontinued", "on_hold", "completed"],
      org_status: ["active", "suspended", "archived"],
      payer_type: [
        "private_pay",
        "medicaid_oss",
        "ltc_insurance",
        "va_aid_attendance",
        "other",
      ],
      payment_method: [
        "check",
        "ach",
        "credit_card",
        "cash",
        "medicaid_payment",
        "insurance_payment",
        "other",
      ],
      payroll_export_batch_status: [
        "draft",
        "queued",
        "exported",
        "failed",
        "voided",
      ],
      pbj_export_batch_status: ["pending", "processing", "complete", "failed"],
      pii_access_tier: ["public_summary", "standard_ops", "clinical_precheck"],
      po_status: [
        "draft",
        "submitted",
        "approved",
        "partially_received",
        "received",
        "closed",
        "cancelled",
      ],
      polst_status: ["none", "on_file", "verified", "revoked"],
      premium_allocation_method: [
        "per_licensed_bed",
        "per_census_day",
        "pct_of_premium",
        "custom",
      ],
      referral_hl7_inbound_status: [
        "pending",
        "processed",
        "failed",
        "ignored",
      ],
      referral_lead_status: [
        "new",
        "contacted",
        "tour_scheduled",
        "tour_completed",
        "application_pending",
        "waitlisted",
        "converted",
        "lost",
        "merged",
      ],
      report_export_format: ["csv", "pdf", "print", "xlsx"],
      report_owner_type: ["system", "organization", "facility", "user"],
      report_run_status: [
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
      ],
      report_schedule_status: ["active", "paused", "failed"],
      report_sharing_scope: ["private", "team", "facility", "organization"],
      report_source_type: ["template", "saved_view", "pack"],
      report_template_status: ["draft", "active", "deprecated", "archived"],
      reputation_platform: [
        "google_business",
        "yelp",
        "facebook",
        "caring_com",
        "other",
      ],
      reputation_reply_status: ["draft", "posted", "failed"],
      resident_observation_assignment_type: [
        "primary",
        "reassignment",
        "rescue",
      ],
      resident_observation_entry_mode: [
        "live",
        "late",
        "offline_synced",
        "bulk",
      ],
      resident_observation_exception_type: [
        "resident_not_found",
        "resident_declined_interaction",
        "resident_appears_ill",
        "resident_appears_injured",
        "environmental_hazard_present",
        "family_concern_reported",
        "assignment_impossible",
        "other",
      ],
      resident_observation_follow_up_status: [
        "open",
        "in_progress",
        "resolved",
        "dismissed",
      ],
      resident_observation_interval_type: [
        "continuous",
        "fixed_minutes",
        "per_shift",
        "daypart",
      ],
      resident_observation_plan_status: [
        "draft",
        "active",
        "paused",
        "ended",
        "cancelled",
      ],
      resident_observation_quick_status: [
        "awake",
        "asleep",
        "calm",
        "agitated",
        "confused",
        "distressed",
        "not_found",
        "refused",
      ],
      resident_observation_severity: ["low", "medium", "high", "critical"],
      resident_observation_source_type: [
        "care_plan",
        "manual",
        "policy",
        "order",
        "triggered",
      ],
      resident_observation_task_status: [
        "upcoming",
        "due_soon",
        "due_now",
        "overdue",
        "critically_overdue",
        "missed",
        "completed_on_time",
        "completed_late",
        "excused",
        "reassigned",
        "escalated",
      ],
      resident_status: [
        "inquiry",
        "pending_admission",
        "active",
        "hospital_hold",
        "loa",
        "discharged",
        "deceased",
      ],
      resident_watch_status: [
        "pending_approval",
        "active",
        "paused",
        "ended",
        "cancelled",
      ],
      room_type: ["private", "semi_private", "shared"],
      schedule_status: ["draft", "published", "archived"],
      shift_assignment_status: [
        "assigned",
        "confirmed",
        "swap_requested",
        "called_out",
        "no_show",
        "completed",
      ],
      shift_classification: [
        "regular",
        "on_call",
        "agency",
        "training",
        "other",
      ],
      shift_type: ["day", "evening", "night", "custom"],
      staff_role: [
        "cna",
        "lpn",
        "rn",
        "administrator",
        "activities_director",
        "dietary_staff",
        "dietary_manager",
        "maintenance",
        "housekeeping",
        "driver",
        "other",
      ],
      training_delivery_method: ["in_person", "external", "online", "hybrid"],
      training_frequency: [
        "at_hire",
        "annual",
        "biennial",
        "as_needed",
        "one_time",
      ],
      transport_request_status: [
        "requested",
        "scheduled",
        "in_progress",
        "completed",
        "cancelled",
      ],
      transport_type: [
        "facility_vehicle",
        "staff_personal_vehicle",
        "third_party",
      ],
      vehicle_inspection_result: ["pass", "fail", "conditional"],
      vendor_category: [
        "maintenance",
        "medical_supply",
        "pharmacy",
        "food_service",
        "staffing_agency",
        "consulting",
        "technology",
        "other",
      ],
      vendor_invoice_status: [
        "draft",
        "submitted",
        "approved",
        "matched",
        "paid",
        "voided",
      ],
      vendor_status: ["draft", "active", "inactive", "blocked"],
    },
  },
} as const
